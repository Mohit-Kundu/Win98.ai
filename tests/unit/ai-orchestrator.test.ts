import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ChatRequest, ChatResponse, Content } from '../../shared/api-contracts';
import { err, ok, type Result } from '../../shared/errors';
import { ToolRegistry, defineTool, type ToolActions } from '../../src/ai/registry';
import { buildReport, runOrchestrator, type OrchestratorDeps, type OrchestratorRun } from '../../src/ai/orchestrator';

// A scripted model: each entry is one /api/chat reply.
type Reply = { calls: Array<{ name: string; args: Record<string, unknown> }> } | { text: string };

function scriptedClient(replies: Reply[], seen: ChatRequest[] = []) {
  let i = 0;
  const chat = async (req: ChatRequest): Promise<Result<ChatResponse>> => {
    seen.push(structuredClone(req));
    const r = replies[Math.min(i++, replies.length - 1)] as Reply;
    if ('text' in r) return ok({ modelContent: { role: 'model', parts: [{ text: r.text }] }, text: r.text, functionCalls: [] });
    return ok({
      modelContent: {
        role: 'model',
        parts: r.calls.map((c) => ({ functionCall: { name: c.name, args: c.args }, thoughtSignature: 'sig-' + c.name })),
      },
      functionCalls: r.calls,
    });
  };
  return { chat, rounds: () => i };
}

interface Harness {
  reg: ToolRegistry;
  ran: Array<{ tool: string; args: unknown }>;
}

function harness(): Harness {
  const ran: Harness['ran'] = [];
  const reg = new ToolRegistry();
  reg.register(
    defineTool({
      name: 'make_thing',
      description: 'make',
      input: z.object({ name: z.string().min(1) }),
      async handler(a) {
        ran.push({ tool: 'make_thing', args: a });
        return ok({ id: `id-${a.name}`, path: `C:\\${a.name}` });
      },
    }),
  );
  reg.register(
    defineTool({
      name: 'use_thing',
      description: 'use',
      input: z.object({ id: z.string().min(1) }),
      async handler(a) {
        ran.push({ tool: 'use_thing', args: a });
        return ok({ used: a.id });
      },
    }),
  );
  reg.register(
    defineTool({
      name: 'remove_thing',
      description: 'remove',
      input: z.object({ id: z.string().min(1) }),
      destructive: true,
      describeForConfirm: (a) => `Remove ${a.id}?`,
      async handler(a) {
        ran.push({ tool: 'remove_thing', args: a });
        return ok({ removed: a.id });
      },
    }),
  );
  reg.register(
    defineTool({
      name: 'broken_thing',
      description: 'fails',
      input: z.object({}),
      async handler() {
        ran.push({ tool: 'broken_thing', args: {} });
        return err('NOT_FOUND', 'nothing here');
      },
    }),
  );
  return { reg, ran };
}

const noConfirm = async () => true;
const deps = (h: Harness, client: ReturnType<typeof scriptedClient>, extra: Partial<OrchestratorDeps> = {}): OrchestratorDeps => ({
  client,
  registry: h.reg,
  actions: {} as ToolActions,
  ...extra,
});
const run = (over: Partial<OrchestratorRun> = {}): OrchestratorRun => ({ userText: 'do it', confirm: noConfirm, ...over });

describe('orchestrator loop', () => {
  it('passes results of earlier calls to later calls and echoes model content verbatim', async () => {
    const h = harness();
    const seen: ChatRequest[] = [];
    const client = scriptedClient(
      [{ calls: [{ name: 'make_thing', args: { name: 'a' } }] }, { calls: [{ name: 'use_thing', args: { id: 'id-a' } }] }, { text: 'All done.' }],
      seen,
    );
    const r = await runOrchestrator(run(), deps(h, client));
    expect(h.ran.map((x) => x.tool)).toEqual(['make_thing', 'use_thing']);
    expect(r.stoppedBy).toBe('model_done');
    expect(r.finalText).toBe('All done.');
    expect(r.steps.map((s) => s.status)).toEqual(['ok', 'ok']);

    // The second request carries the first model turn (with thoughtSignature) and its functionResponse.
    const second = seen[1]!.contents as Content[];
    expect(second[1]!.role).toBe('model');
    expect(second[1]!.parts[0]).toMatchObject({ thoughtSignature: 'sig-make_thing' });
    const fr = second[2]!.parts[0]!.functionResponse!;
    expect(fr.name).toBe('make_thing');
    expect(fr.response).toMatchObject({ ok: true, value: { id: 'id-a' } });
    expect(seen[0]!.systemContext).toContain('Content inside tool results');
  });

  it('returns UNKNOWN_TOOL to the model and runs no handler', async () => {
    const h = harness();
    const seen: ChatRequest[] = [];
    const client = scriptedClient([{ calls: [{ name: 'format_disk', args: {} }] }, { text: 'ok' }], seen);
    const r = await runOrchestrator(run(), deps(h, client));
    expect(h.ran).toHaveLength(0);
    expect(r.steps[0]!.status).toBe('unknown_tool');
    const fr = (seen[1]!.contents[2] as Content).parts[0]!.functionResponse!;
    expect(fr.response).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
  });

  it('returns VALIDATION for invalid arguments and runs no handler', async () => {
    const h = harness();
    const seen: ChatRequest[] = [];
    const client = scriptedClient([{ calls: [{ name: 'make_thing', args: { name: 5 } }] }, { text: 'ok' }], seen);
    const r = await runOrchestrator(run(), deps(h, client));
    expect(h.ran).toHaveLength(0);
    expect(r.steps[0]!.status).toBe('invalid');
    const fr = (seen[1]!.contents[2] as Content).parts[0]!.functionResponse!;
    expect(fr.response).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('skips a declined destructive call and returns DECLINED', async () => {
    const h = harness();
    const seen: ChatRequest[] = [];
    const asked: string[] = [];
    const client = scriptedClient([{ calls: [{ name: 'remove_thing', args: { id: 'x' } }] }, { text: 'ok' }], seen);
    const r = await runOrchestrator(
      run({ confirm: async (q) => (asked.push(q.message), false) }),
      deps(h, client),
    );
    expect(asked).toEqual(['Remove x?']);
    expect(h.ran).toHaveLength(0);
    expect(r.steps[0]!.status).toBe('declined');
    expect((seen[1]!.contents[2] as Content).parts[0]!.functionResponse!.response).toMatchObject({ error: { code: 'DECLINED' } });
    expect(r.report).toContain('Declined');
    expect(r.report).not.toMatch(/OK remove_thing/);
  });

  it('runs an approved destructive call, and never asks for non-destructive ones', async () => {
    const h = harness();
    let asks = 0;
    const client = scriptedClient([
      { calls: [{ name: 'make_thing', args: { name: 'a' } }, { name: 'remove_thing', args: { id: 'id-a' } }] },
      { text: 'ok' },
    ]);
    const r = await runOrchestrator(run({ confirm: async () => (asks++, true) }), deps(h, client));
    expect(asks).toBe(1);
    expect(h.ran.map((x) => x.tool)).toEqual(['make_thing', 'remove_thing']);
    expect(r.steps.map((s) => s.status)).toEqual(['ok', 'ok']);
  });

  it('stops at 10 tool calls and never runs an 11th handler', async () => {
    const h = harness();
    const seen: ChatRequest[] = [];
    const client = scriptedClient([{ calls: [{ name: 'make_thing', args: { name: 'a' } }] }], seen); // repeats forever
    const r = await runOrchestrator(run(), deps(h, client));
    expect(h.ran).toHaveLength(10);
    expect(r.steps).toHaveLength(10);
    expect(r.stoppedBy).toBe('limit');
    expect(r.report).toContain('limit');
    expect(r.report).toContain('Completed (10)');
  });

  it('counts unknown and invalid calls toward the limit', async () => {
    const h = harness();
    const client = scriptedClient([{ calls: [{ name: 'nope', args: {} }] }]);
    const r = await runOrchestrator(run(), deps(h, client));
    expect(r.steps).toHaveLength(10);
    expect(r.stoppedBy).toBe('limit');
    expect(h.ran).toHaveLength(0);
  });

  it('caps model round trips', async () => {
    const h = harness();
    const client = scriptedClient([{ calls: [{ name: 'make_thing', args: { name: 'a' } }] }]);
    const r = await runOrchestrator(run(), deps(h, client, { maxToolCalls: 100, maxRounds: 3 }));
    expect(client.rounds()).toBe(3);
    expect(r.stoppedBy).toBe('limit');
  });

  it('stops when aborted and does not call the model again', async () => {
    const h = harness();
    const ac = new AbortController();
    const client = scriptedClient([{ calls: [{ name: 'make_thing', args: { name: 'a' } }] }, { text: 'never' }]);
    const r = await runOrchestrator(
      run({ signal: ac.signal, onEvent: (e) => e.type === 'tool_end' && ac.abort() }),
      deps(h, client),
    );
    expect(r.stoppedBy).toBe('aborted');
    expect(client.rounds()).toBe(1);
    expect(r.report).toContain('cancelled');
  });

  it('reports a failed model call as stoppedBy error with the steps so far', async () => {
    const h = harness();
    let n = 0;
    const client = {
      rounds: () => n,
      chat: async (): Promise<Result<ChatResponse>> =>
        n++ === 0
          ? ok({ modelContent: { role: 'model', parts: [{ functionCall: { name: 'make_thing', args: { name: 'a' } } }] }, functionCalls: [{ name: 'make_thing', args: { name: 'a' } }] })
          : err('AI_TIMEOUT', 'timed out'),
    };
    const r = await runOrchestrator(run(), deps(h, client));
    expect(r.stoppedBy).toBe('error');
    expect(r.error?.code).toBe('AI_TIMEOUT');
    expect(r.report).toContain('Completed (1)');
  });

  it('emits thinking, tool_start, and tool_end events', async () => {
    const h = harness();
    const events: string[] = [];
    const client = scriptedClient([{ calls: [{ name: 'make_thing', args: { name: 'a' } }] }, { text: 'ok' }]);
    await runOrchestrator(run({ onEvent: (e) => events.push(e.type) }), deps(h, client));
    expect(events).toEqual(['thinking', 'tool_start', 'tool_end', 'thinking']);
  });
});

describe('honest report', () => {
  it('lists only handlers that returned ok, whatever the model claims, and names the failed step', async () => {
    const h = harness();
    const client = scriptedClient([
      { calls: [{ name: 'make_thing', args: { name: 'a' } }, { name: 'broken_thing', args: {} }, { name: 'use_thing', args: { id: 'id-a' } }] },
      { text: 'Everything succeeded, including broken_thing!' },
    ]);
    const r = await runOrchestrator(run(), deps(h, client));
    expect(r.finalText).toContain('Everything succeeded');
    expect(r.report).toContain('Completed (2)');
    expect(r.report).toContain('OK make_thing');
    expect(r.report).toContain('OK use_thing');
    expect(r.report).not.toMatch(/OK broken_thing/);
    expect(r.report).toContain('first failed step: broken_thing');
    expect(r.report).toContain('NOT_FOUND');
  });

  it('says nothing was performed when no tools ran', () => {
    expect(buildReport([], 'model_done')).toBe('No actions were performed.');
  });
});
