import { describe, expect, it, vi } from 'vitest';
import { createOpenRouterClient, createOpenRouterClientFromEnv, toOpenAiMessages } from './openrouter.js';
import { resolveProvider, selectGeminiClient } from './index.js';

const signal = new AbortController().signal;

function clientReplying(body: unknown, status = 200, imageApi: 'images' | 'chat' = 'chat') {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const client = createOpenRouterClient({
    apiKey: 'k',
    textModel: 'text/model',
    imageModel: 'image/model',
    baseUrl: 'https://example.test/v1',
    imageApi,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
}

describe('provider flag', () => {
  it('defaults to openrouter and accepts gemini', () => {
    expect(resolveProvider({})).toBe('openrouter');
    expect(resolveProvider({ AI_PROVIDER: 'Gemini' })).toBe('gemini');
    expect(() => resolveProvider({ AI_PROVIDER: 'nope' })).toThrow();
  });
  it('selects the client matching the flag and its key', async () => {
    expect((await selectGeminiClient({ AI_PROVIDER: 'openrouter', GEMINI_API_KEY: 'g' }, ['node', 'x'])).gemini).toBeNull();
    expect((await selectGeminiClient({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'o' }, ['node', 'x'])).gemini).not.toBeNull();
    expect((await selectGeminiClient({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' }, ['node', 'x'])).gemini).not.toBeNull();
    expect(createOpenRouterClientFromEnv({})).toBeNull();
  });
});

describe('toOpenAiMessages', () => {
  it('pairs id-less function calls with their responses', () => {
    const msgs = toOpenAiMessages(
      [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ functionCall: { name: 'open_app', args: { app: 'paint' } } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'open_app', response: { ok: true } } }] },
      ],
      'sys',
    );
    const call = msgs[2] as { tool_calls: { id: string }[] };
    const result = msgs[3] as { role: string; tool_call_id: string };
    expect(result.role).toBe('tool');
    expect(result.tool_call_id).toBe(call.tool_calls[0]!.id);
  });
});

describe('OpenRouter client', () => {
  it('maps tool calls to a Gemini-shaped model turn', async () => {
    const { client, fetchMock } = clientReplying({
      choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'open_app', arguments: '{"app":"paint"}' } }] } }],
    });
    const res = await client.chat({ contents: [{ role: 'user', parts: [{ text: 'open paint' }] }], tools: [{ name: 'open_app', description: 'd' }] }, signal);
    expect(res.functionCalls).toEqual([{ name: 'open_app', args: { app: 'paint' } }]);
    expect(res.modelContent.parts[0]?.functionCall?.id).toBe('c1');
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { model: string; tools: unknown[] };
    expect(sent.model).toBe('text/model');
    expect(sent.tools).toHaveLength(1);
  });

  it('parses fenced JSON and validates it', async () => {
    const payload = '```json\n{"title":"t","description":"d","category":"c","tags":["a"]}\n```';
    const { client } = clientReplying({ choices: [{ message: { content: payload } }] });
    await expect(client.metadata({ name: 'a.txt', mime: 'text/plain', kind: 'text', text: 'x' }, signal)).resolves.toMatchObject({ title: 't' });
  });

  it('extracts a generated image from a data URL', async () => {
    const { client } = clientReplying({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,QUJD' } }] } }] });
    await expect(client.generateImage({ prompt: 'cat' }, signal)).resolves.toEqual({ mimeType: 'image/png', dataBase64: 'QUJD' });
  });

  it('generates images through the dedicated images endpoint', async () => {
    const { client, fetchMock } = clientReplying({ data: [{ b64_json: 'QUJD', media_type: 'image/png' }] }, 200, 'images');
    await expect(client.generateImage({ prompt: 'cat', aspect: '4:3' }, signal)).resolves.toEqual({ mimeType: 'image/png', dataBase64: 'QUJD' });
    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(call[0]).toBe('https://example.test/v1/images');
    expect(JSON.parse(call[1].body)).toMatchObject({ model: 'image/model', prompt: 'cat', aspect_ratio: '4:3' });
  });

  it('maps HTTP failures to GeminiError codes', async () => {
    const auth = clientReplying({}, 401).client;
    await expect(auth.textTransform({ mode: 'summarize', text: 'x' }, signal)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    const bad = clientReplying({}, 500).client;
    await expect(bad.textTransform({ mode: 'summarize', text: 'x' }, signal)).rejects.toMatchObject({ code: 'AI_FAILED' });
  });
});
