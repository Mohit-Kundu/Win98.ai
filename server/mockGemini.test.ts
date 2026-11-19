// @vitest-environment node
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, selectGeminiClient } from './index.js';
import { DEFAULT_STUB_PNG, createMockGeminiClient, loadScripts, mockRequestMiddleware } from './mockGemini.js';
import { ChatResponseSchema } from '../shared/api-contracts.js';

const app = () => createApp({ gemini: createMockGeminiClient(), middleware: [mockRequestMiddleware] });
const user = (text: string) => ({ role: 'user' as const, parts: [{ text }] });

describe('Mock_Gemini', () => {
  it('ships a valid PNG stub and four valid scripts', () => {
    const png = fs.readFileSync(DEFAULT_STUB_PNG);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(64);
    expect(loadScripts().map((s) => s.name)).toEqual(['create-folder', 'report-on-ai', 'rewrite', 'search-ml']);
  });

  it('runs the Report on AI script with placeholders resolved from functionResponse', async () => {
    const a = app();
    const contents: unknown[] = [user('Create a report on AI with an image of data centers')];
    const results = [
      { ok: true, value: { fileId: 'DOC1', path: 'C:\\My Documents\\Report on AI.wpd' } },
      { ok: true, value: { fileId: 'IMG1', path: 'C:\\My Pictures\\data-center.png' } },
      { ok: true, value: { documentId: 'DOC1' } },
      { ok: true, value: { windowId: 'w1' } },
    ];
    const names: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(a).post('/api/chat').send({ contents, tools: [] });
      expect(res.status).toBe(200);
      const body = ChatResponseSchema.parse(res.body);
      contents.push(body.modelContent);
      if (!body.functionCalls.length) {
        expect(body.text).toContain('C:\\My Documents\\Report on AI.wpd');
        break;
      }
      const call = body.functionCalls[0]!;
      names.push(call.name);
      if (call.name === 'insert_image_into_document') {
        expect(call.args).toMatchObject({ documentId: 'DOC1', imageId: 'IMG1', position: { afterHeading: 'Data Centers' } });
      }
      if (call.name === 'create_document') {
        const html = String(call.args['contentHtml']);
        for (const h of ['History of LLMs', 'How LLMs Work', 'Applications', 'Implications', 'Data Centers']) expect(html).toContain(h);
      }
      contents.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response: results[i] } }] });
    }
    expect(names).toEqual(['create_document', 'generate_image', 'insert_image_into_document', 'open_file']);
  });

  it('selects scripts by x-mock-script header and by user text', async () => {
    const byText = await request(app())
      .post('/api/chat')
      .send({ contents: [user('Create a folder called AI Research in My Documents')], tools: [] });
    expect(byText.body.functionCalls[0].name).toBe('create_folder');
    const byHeader = await request(app())
      .post('/api/chat')
      .set('x-mock-script', 'create-folder')
      .send({ contents: [user('hello')], tools: [] });
    expect(byHeader.body.functionCalls[0].name).toBe('create_folder');
  });

  it('returns a stub PNG, deterministic metadata, search, organize and text transforms', async () => {
    const a = app();
    const img = await request(a).post('/api/generate-image').send({ prompt: 'x' });
    expect(Buffer.from(img.body.dataBase64, 'base64').equals(fs.readFileSync(DEFAULT_STUB_PNG))).toBe(true);

    const meta = await request(a).post('/api/metadata').send({ name: 'ml-intro.txt', mime: 'text/plain', kind: 'text', text: 'Intro to Machine Learning' });
    expect(meta.body).toMatchObject({ category: 'Technology/AI' });

    const sq = await request(a).post('/api/search-query').send({ query: 'the document about machine learning', now: '2026-01-15T00:00:00Z' });
    expect(sq.body).toEqual({ terms: 'machine learning' });

    const org = await request(a)
      .post('/api/organize')
      .send({ files: [{ id: 'f1', name: 'a.png', type: 'png' }], folders: ['C:\\My Pictures'] });
    expect(org.body).toEqual({ moves: [{ fileId: 'f1', destination: 'C:\\My Pictures' }] });

    const tt = await request(a).post('/api/text-transform').send({ mode: 'rewrite', text: 'hi' });
    expect(tt.body).toEqual({ text: '[rewritten] hi' });
  });

  it('injects failures through x-mock-fail', async () => {
    const a = app();
    for (const [mode, status, code] of [['timeout', 504, 'AI_TIMEOUT'], ['error', 502, 'AI_FAILED'], ['nokey', 503, 'AI_UNAVAILABLE']] as const) {
      const res = await request(a).post('/api/generate-image').set('x-mock-fail', mode).send({ prompt: 'x' });
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    }
  });

  it('is selected only with MOCK_GEMINI=1 and never in production mode', async () => {
    expect((await selectGeminiClient({ MOCK_GEMINI: '1' }, ['node', 'x'])).middleware).toHaveLength(1);
    expect((await selectGeminiClient({}, ['node', 'x'])).gemini).toBeNull();
    expect((await selectGeminiClient({ MOCK_GEMINI: '1' }, ['node', 'x', '--production'])).gemini).toBeNull();
    expect((await selectGeminiClient({ MOCK_GEMINI: '0' }, ['node', 'x'])).gemini).toBeNull();
  });
});
