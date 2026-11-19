import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FunctionDeclarationSchema } from '../../shared/api-contracts';
import { ok } from '../../shared/errors';
import {
  ToolRegistry,
  defineTool,
  isDestructive,
  sanitizeForGemini,
  toFunctionDeclaration,
} from '../../src/ai/registry';

const makeTool = (name: string, extra: Partial<Parameters<typeof defineTool>[0]> = {}) =>
  defineTool({
    name,
    description: 'Test tool',
    input: z.object({ path: z.string().describe('A path'), mode: z.enum(['a', 'b']).optional() }),
    handler: async () => ok({}),
    ...extra,
  } as never);

describe('ToolRegistry', () => {
  it('registers and looks up tools', () => {
    const r = new ToolRegistry();
    const t = makeTool('list_folder');
    r.register(t);
    expect(r.get('list_folder')).toBe(t);
    expect(r.get('nope_tool')).toBeUndefined();
    expect(r.list()).toHaveLength(1);
  });

  it('rejects duplicate names', () => {
    const r = new ToolRegistry();
    r.register(makeTool('list_folder'));
    expect(() => r.register(makeTool('list_folder'))).toThrow(/already registered/);
  });

  it('rejects invalid names', () => {
    const r = new ToolRegistry();
    for (const bad of ['Bad', 'ab', '1abc', 'has-dash', 'a'.repeat(65)]) {
      expect(() => r.register(makeTool(bad))).toThrow(/Invalid tool name/);
    }
  });

  it('filters by appScope', () => {
    const r = new ToolRegistry();
    r.register(makeTool('general_tool'));
    r.register(makeTool('paint_only', { appScope: ['paint'] }));
    expect(r.toolsFor('wordpad').map((t) => t.name)).toEqual(['general_tool']);
    expect(r.toolsFor('paint').map((t) => t.name)).toEqual(['general_tool', 'paint_only']);
    expect(r.toolsFor().map((t) => t.name)).toEqual(['general_tool']);
  });

  it('evaluates static and computed destructive flags', () => {
    const t = makeTool('x_tool', { destructive: (a: { mode?: string }) => a.mode === 'a' } as never);
    expect(isDestructive(t, { mode: 'a' })).toBe(true);
    expect(isDestructive(t, { mode: 'b' })).toBe(false);
    expect(isDestructive(makeTool('y_tool', { destructive: true }), {})).toBe(true);
    expect(isDestructive(makeTool('z_tool'), {})).toBe(false);
  });
});

describe('toFunctionDeclaration / sanitizeForGemini', () => {
  it('produces a declaration accepted by the API contract with no rejected keywords', () => {
    const t = makeTool('list_folder');
    const decl = toFunctionDeclaration(t);
    expect(FunctionDeclarationSchema.safeParse(decl).success).toBe(true);
    const json = JSON.stringify(decl.parametersJsonSchema);
    expect(json).not.toContain('$schema');
    expect(json).not.toContain('additionalProperties');
    expect(decl.parametersJsonSchema.type).toBe('object');
    expect(decl.parametersJsonSchema.required).toEqual(['path']);
  });

  it('strips unsupported keywords and formats but keeps property names', () => {
    const out = sanitizeForGemini({
      $schema: 'x',
      type: 'object',
      additionalProperties: false,
      properties: {
        additionalProperties: { type: 'string', format: 'email' },
        when: { type: 'string', format: 'date-time' },
        items: { type: 'array', items: { type: 'object', additionalProperties: {}, properties: {} } },
      },
    });
    expect(out).toEqual({
      type: 'object',
      properties: {
        additionalProperties: { type: 'string' },
        when: { type: 'string', format: 'date-time' },
        items: { type: 'array', items: { type: 'object', properties: {} } },
      },
    });
  });

  it('removes email/uuid formats emitted by Zod', () => {
    const t = makeTool('fmt_tool', { input: z.object({ id: z.uuid(), at: z.iso.datetime() }) } as never);
    const props = (toFunctionDeclaration(t).parametersJsonSchema.properties ?? {}) as Record<string, { format?: string }>;
    expect(props.id?.format).toBeUndefined();
    expect(props.at?.format).toBe('date-time');
  });
});
