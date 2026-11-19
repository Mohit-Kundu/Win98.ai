import { describe, expect, it } from 'vitest';
import {
  ChatRequestSchema,
  ChatResponseSchema,
  GenerateImageRequestSchema,
  HealthResponseSchema,
  MetadataRequestSchema,
  MetadataResponseSchema,
  OrganizeRequestSchema,
  OrganizeResponseSchema,
  SearchQueryRequestSchema,
  SearchQueryResponseSchema,
  TextTransformRequestSchema,
} from '../../shared/api-contracts';

describe('api-contracts', () => {
  it('health response', () => {
    expect(HealthResponseSchema.safeParse({ ok: true, ai: false }).success).toBe(true);
    expect(HealthResponseSchema.safeParse({ ok: true }).success).toBe(false);
  });

  it('chat request accepts function parts and preserves unknown keys', () => {
    const body = {
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        {
          role: 'model',
          parts: [{ functionCall: { name: 'create_folder', args: { path: 'a' } }, thoughtSignature: 'sig' }],
        },
        { role: 'user', parts: [{ functionResponse: { name: 'create_folder', response: { ok: true } } }] },
      ],
      tools: [{ name: 'create_folder', description: 'd', parametersJsonSchema: { type: 'object' } }],
    };
    const r = ChatRequestSchema.safeParse(body);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contents[1]?.parts[0]).toHaveProperty('thoughtSignature', 'sig');
  });

  it('chat request rejects bad role, empty contents, and bad tool name', () => {
    expect(ChatRequestSchema.safeParse({ contents: [], tools: [] }).success).toBe(false);
    expect(
      ChatRequestSchema.safeParse({ contents: [{ role: 'system', parts: [{ text: 'x' }] }], tools: [] }).success,
    ).toBe(false);
    expect(
      ChatRequestSchema.safeParse({
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        tools: [{ name: 'Bad Name', description: 'd' }],
      }).success,
    ).toBe(false);
  });

  it('chat response', () => {
    const good = {
      modelContent: { role: 'model', parts: [{ text: 'done' }] },
      text: 'done',
      functionCalls: [],
    };
    expect(ChatResponseSchema.safeParse(good).success).toBe(true);
    expect(ChatResponseSchema.safeParse({ ...good, functionCalls: [{ name: 'x' }] }).success).toBe(false);
  });

  it('generate-image prompt limits', () => {
    expect(GenerateImageRequestSchema.safeParse({ prompt: 'a cat', aspect: '1:1' }).success).toBe(true);
    expect(GenerateImageRequestSchema.safeParse({ prompt: 'x'.repeat(2001) }).success).toBe(false);
    expect(GenerateImageRequestSchema.safeParse({ prompt: 'a', aspect: '2:1' }).success).toBe(false);
  });

  it('metadata request and response', () => {
    expect(MetadataRequestSchema.safeParse({ name: 'a.txt', mime: 'text/plain', kind: 'text', text: 'hello' }).success).toBe(true);
    expect(MetadataRequestSchema.safeParse({ name: 'a.txt', mime: 'text/plain', kind: 'text', text: 'x'.repeat(20_001) }).success).toBe(false);
    expect(MetadataRequestSchema.safeParse({ name: 'a', mime: 'm', kind: 'video' }).success).toBe(false);
    expect(MetadataResponseSchema.safeParse({ title: 't', description: 'd', category: 'c', tags: ['a'] }).success).toBe(true);
    expect(MetadataResponseSchema.safeParse({ title: 't', description: 'd', category: 'c' }).success).toBe(false);
  });

  it('search-query request and response', () => {
    expect(SearchQueryRequestSchema.safeParse({ query: 'ml docs', now: '2025-01-01T00:00:00.000Z' }).success).toBe(true);
    expect(SearchQueryRequestSchema.safeParse({ query: 'ml', now: 'yesterday' }).success).toBe(false);
    expect(SearchQueryResponseSchema.safeParse({ terms: 'ml', type: 'pdf', createdRange: [1, 2] }).success).toBe(true);
    expect(SearchQueryResponseSchema.safeParse({ terms: 'ml', type: 'exe' }).success).toBe(false);
    expect(SearchQueryResponseSchema.safeParse({ terms: 'ml', createdRange: [1] }).success).toBe(false);
  });

  it('organize request and response', () => {
    expect(
      OrganizeRequestSchema.safeParse({ files: [{ id: '1', name: 'a.txt', type: 'txt' }], folders: ['C:\\My Documents'] }).success,
    ).toBe(true);
    expect(OrganizeRequestSchema.safeParse({ files: [], folders: [] }).success).toBe(false);
    expect(OrganizeResponseSchema.safeParse({ moves: [{ fileId: '1', destination: 'C:\\x' }] }).success).toBe(true);
    expect(OrganizeResponseSchema.safeParse({ moves: [{ fileId: '1' }] }).success).toBe(false);
  });

  it('text-transform request rules', () => {
    expect(TextTransformRequestSchema.safeParse({ mode: 'rewrite', text: 'abc' }).success).toBe(true);
    expect(TextTransformRequestSchema.safeParse({ mode: 'generate', instruction: 'write a poem' }).success).toBe(true);
    expect(TextTransformRequestSchema.safeParse({ mode: 'rewrite' }).success).toBe(false);
    expect(TextTransformRequestSchema.safeParse({ mode: 'generate' }).success).toBe(false);
    expect(TextTransformRequestSchema.safeParse({ mode: 'translate', text: 'a' }).success).toBe(false);
  });
});
