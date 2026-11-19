// @vitest-environment node
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './index.js';
import { GeminiError } from './geminiClient.js';
import type { GeminiClient } from './geminiClient.js';

const never = () => Promise.reject(new Error('not used'));
function client(over: Partial<GeminiClient> = {}): GeminiClient {
  return { chat: never, generateImage: never, metadata: never, searchQuery: never, organize: never, textTransform: never, ...over };
}
const quiet = () => undefined;

describe('AI proxy app', () => {
  it('reports ai flag in health', async () => {
    expect((await request(createApp({ gemini: null })).get('/api/health')).body).toEqual({ ok: true, ai: false });
    expect((await request(createApp({ gemini: client() })).get('/api/health')).body).toEqual({ ok: true, ai: true });
  });

  it('returns 503 AI_UNAVAILABLE without a client', async () => {
    const res = await request(createApp({ gemini: null })).post('/api/generate-image').send({ prompt: 'a cat' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('returns 400 for invalid and malformed bodies without calling the client', async () => {
    let calls = 0;
    const app = createApp({ gemini: client({ generateImage: () => (calls++, never()) }) });
    const bad = await request(app).post('/api/generate-image').send({ prompt: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
    const malformed = await request(app).post('/api/generate-image').set('content-type', 'application/json').send('{nope');
    expect(malformed.status).toBe(400);
    expect(calls).toBe(0);
  });

  it('returns 413 for bodies over 10 MB', async () => {
    const app = createApp({ gemini: client() });
    const res = await request(app).post('/api/metadata').send({ name: 'a', mime: 'text/plain', kind: 'text', text: 'x'.repeat(11 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('TOO_LARGE');
  });

  it('maps success, timeout, and other failures', async () => {
    const ok = createApp({ gemini: client({ textTransform: async () => ({ text: 'hi' }) }) });
    const good = await request(ok).post('/api/text-transform').send({ mode: 'rewrite', text: 'x' });
    expect(good.status).toBe(200);
    expect(good.body).toEqual({ text: 'hi' });

    const timeout = createApp({ gemini: client({ textTransform: async () => { throw new GeminiError('AI_TIMEOUT'); } }), log: quiet });
    expect((await request(timeout).post('/api/text-transform').send({ mode: 'rewrite', text: 'x' })).status).toBe(504);

    const secret = 'sk-secret-key-123';
    const failing = createApp({ gemini: client({ textTransform: async () => { throw new Error(`boom ${secret}`); } }), log: quiet });
    const res = await request(failing).post('/api/text-transform').send({ mode: 'rewrite', text: 'x' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_FAILED');
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });

  it('aborts the client signal and returns 504 when the timeout elapses', async () => {
    const slow = client({
      textTransform: (_r, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))),
    });
    const res = await request(createApp({ gemini: slow, timeoutMs: 20, log: quiet })).post('/api/text-transform').send({ mode: 'rewrite', text: 'x' });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('AI_TIMEOUT');
  });

  it('returns 502 when model output fails response validation', async () => {
    const app = createApp({ gemini: client({ metadata: async () => ({ title: 1 }) as never }), log: quiet });
    const res = await request(app).post('/api/metadata').send({ name: 'a.txt', mime: 'text/plain', kind: 'text', text: 'x' });
    expect(res.status).toBe(502);
  });
});
