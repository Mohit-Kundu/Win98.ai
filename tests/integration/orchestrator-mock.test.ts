import fs from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatRequestSchema, ChatResponseSchema, type GenerateImageRequest } from '../../shared/api-contracts';
import { err, ok } from '../../shared/errors';
import { createMockGeminiClient, DEFAULT_STUB_PNG } from '../../server/mockGemini';
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
import { ToolRegistry, type ToolActions } from '../../src/ai/registry';
import { registerCoreTools } from '../../src/ai/tools';
import { runOrchestrator, type OrchestratorDeps } from '../../src/ai/orchestrator';

// Mock_Gemini scripts drive the real Orchestrator, real tools, real actions, and a fake-indexeddb VFS.
const mock = createMockGeminiClient();
const never = new AbortController().signal;

let svc: VfsService;
let deps: OrchestratorDeps;
let opened: Array<{ appId: string; launchArgs?: unknown }>;
let n = 0;

beforeEach(async () => {
  svc = createVfsService(new VfsDb(`test-orch-${n++}`), new VfsEmitter());
  await svc.init();
  opened = [];
  const core = createCoreActions({
    vfs: svc,
    launch: (appId, launchArgs) => (opened.push({ appId, launchArgs }), `w${opened.length}`),
  });
  const docs = createDocumentActions({ vfs: svc, core, bus: new DocumentBus() });
  const images = createImageActions({
    ai: {
      generateImage: async (req: GenerateImageRequest) => {
        try {
          return ok(await mock.generateImage(req, never));
        } catch {
          return err('AI_FAILED', 'mock failed');
        }
      },
    },
    drawings: docs,
  });
  const reg = new ToolRegistry();
  registerCoreTools(reg);
  deps = {
    registry: reg,
    actions: { ...core, ...docs, ...images, searchFiles: createSearchService({ vfs: svc, index: createSearchIndex({ vfs: svc }) }).searchFiles, organizeFiles: createOrganizeService({ vfs: svc }).organizeFiles, executeCommand: createExecuteCommand(core) } as ToolActions,
    // Same validation the Express route applies, then the mock call layer.
    client: {
      chat: async (req) => {
        const parsed = ChatRequestSchema.safeParse(req);
        if (!parsed.success) return err('VALIDATION', 'bad request', parsed.error.issues);
        return ok(ChatResponseSchema.parse(await mock.chat(parsed.data, never)));
      },
    },
  };
});

describe('orchestrator with Mock_Gemini scripts', () => {
  it('create-folder: creates the folder through the real tool', async () => {
    const r = await runOrchestrator(
      { userText: 'Create a folder called AI Research in My Documents', confirm: async () => true },
      deps,
    );
    expect(r.stoppedBy).toBe('model_done');
    expect(r.steps.map((s) => [s.tool, s.status])).toEqual([['create_folder', 'ok']]);
    expect(r.finalText).toContain('AI Research');
    expect(r.report).toContain('C:\\My Documents\\AI Research');
    const found = await svc.resolve('C:\\My Documents\\AI Research');
    expect(found.ok && found.value.kind).toBe('folder');
  });

  it('search-ml: search_files hits feed the dependent open_file call', async () => {
    const doc = await deps.actions!.createDocument({ path: 'C:\\My Documents\\ml-intro.wpd', contentHtml: '<p>An intro to machine learning.</p>' });
    expect(doc.ok).toBe(true);
    const r = await runOrchestrator({ userText: 'Find the document about machine learning', confirm: async () => true }, deps);
    expect(r.stoppedBy).toBe('model_done');
    expect(r.steps.map((s) => [s.tool, s.status])).toEqual([
      ['search_files', 'ok'],
      ['open_file', 'ok'],
    ]);
    expect(r.steps[1]?.args).toEqual({ fileId: doc.ok ? doc.value.fileId : '' });
    expect(opened.at(-1)).toEqual({ appId: 'wordpad', launchArgs: { fileId: doc.ok ? doc.value.fileId : '' } });
  });

  it('report-on-ai: creates the document and image, inserts the image, opens the file', async () => {
    const r = await runOrchestrator(
      { userText: 'Create a report on AI and save it', confirm: async () => true },
      deps,
    );
    expect(r.stoppedBy).toBe('model_done');
    expect(r.steps.map((s) => [s.tool, s.status])).toEqual([
      ['create_document', 'ok'],
      ['generate_image', 'ok'],
      ['insert_image_into_document', 'ok'],
      ['open_file', 'ok'],
    ]);

    const doc = await svc.resolve('C:\\My Documents\\Report on AI.wpd');
    const img = await svc.resolve('C:\\My Pictures\\data-center.png');
    expect(doc.ok && img.ok).toBe(true);
    if (!doc.ok || !img.ok) return;

    const stored = await svc.read(doc.value.id);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const json = new TextDecoder().decode(stored.value.bytes);
    for (const h of ['History of LLMs', 'How LLMs Work', 'Applications', 'Implications', 'Data Centers']) expect(json).toContain(h);
    expect(json).toContain(img.value.id); // image node references the VFS id
    expect(json.indexOf('Data Centers')).toBeLessThan(json.indexOf(img.value.id));

    const png = await svc.read(img.value.id);
    expect(png.ok && Buffer.from(png.value.bytes).equals(fs.readFileSync(DEFAULT_STUB_PNG))).toBe(true);

    expect(opened.at(-1)?.appId).toBe('wordpad');
    expect(r.finalText).toContain('C:\\My Documents\\Report on AI.wpd');
    expect(r.report).toContain('Completed (4)');
  });

  it('rewrite: asks for confirmation before the destructive replace and keeps the document when declined', async () => {
    const created = await deps.actions!.createDocument({ path: 'C:\\My Documents\\note.wpd', contentHtml: '<p>Original text.</p>' });
    expect(created.ok).toBe(true);
    const asked: string[] = [];
    const r = await runOrchestrator(
      { userText: 'Rewrite "C:\\My Documents\\note.wpd"', confirm: async (q) => (asked.push(q.tool), false) },
      deps,
    );
    expect(asked).toEqual(['update_document']);
    expect(r.steps.map((s) => s.status)).toEqual(['ok', 'declined']);
    const read = await deps.actions!.readDocument({ path: 'C:\\My Documents\\note.wpd' });
    expect(read.ok && read.value.text).toContain('Original text.');
    expect(r.report).toContain('Declined');
  });
});
