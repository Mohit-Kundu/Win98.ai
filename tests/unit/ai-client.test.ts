import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiClient, isAiAvailable } from '../../src/ai/client';

function mockFetch(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe('aiClient', () => {
  it('returns validated value on success', async () => {
    const f = mockFetch(200, { text: 'hi' });
    const r = await aiClient.textTransform({ mode: 'rewrite', text: 'x' });
    expect(r).toEqual({ ok: true, value: { text: 'hi' } });
    expect(f).toHaveBeenCalledWith('/api/text-transform', expect.objectContaining({ method: 'POST' }));
  });

  it.each([
    [400, 'VALIDATION', 'VALIDATION'],
    [413, 'TOO_LARGE', 'TOO_LARGE'],
    [502, 'AI_FAILED', 'AI_FAILED'],
    [503, 'AI_UNAVAILABLE', 'AI_UNAVAILABLE'],
    [504, 'AI_TIMEOUT', 'AI_TIMEOUT'],
  ])('maps HTTP %i to %s', async (status, envCode, expected) => {
    mockFetch(status, { error: { code: envCode, message: 'm' } });
    const r = await aiClient.generateImage({ prompt: 'a' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(expected);
  });

  it('maps non-envelope error bodies by status', async () => {
    mockFetch(504, 'nope');
    const r = await aiClient.organize({ files: [{ id: '1', name: 'a', type: 'txt' }], folders: [] });
    expect(!r.ok && r.error.code).toBe('AI_TIMEOUT');
  });

  it('rejects malformed success bodies', async () => {
    mockFetch(200, { wrong: true });
    const r = await aiClient.metadata({ name: 'a', mime: 'text/plain', kind: 'text' });
    expect(!r.ok && r.error.code).toBe('AI_FAILED');
  });

  it('returns AI_UNAVAILABLE when fetch rejects, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    const r = await aiClient.health();
    expect(!r.ok && r.error.code).toBe('AI_UNAVAILABLE');
  });

  it('passes the abort signal and reports cancellation', async () => {
    const ac = new AbortController();
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(init?.signal).toBe(ac.signal);
      throw new DOMException('aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', f);
    ac.abort();
    const r = await aiClient.searchQuery({ query: 'q', now: new Date().toISOString() }, { signal: ac.signal });
    expect(!r.ok && r.error.details).toEqual({ aborted: true });
  });

  it('isAiAvailable reflects health.ai and is false on failure', async () => {
    mockFetch(200, { ok: true, ai: true });
    expect(await isAiAvailable()).toBe(true);
    mockFetch(200, { ok: true, ai: false });
    expect(await isAiAvailable()).toBe(false);
    mockFetch(503, { error: { code: 'AI_UNAVAILABLE', message: 'x' } });
    expect(await isAiAvailable()).toBe(false);
  });
});
