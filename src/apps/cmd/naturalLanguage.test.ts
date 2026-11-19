import { describe, expect, it } from 'vitest';
import { err, ok } from '../../../shared/errors';
import { buildReport } from '../../ai/orchestrator';
import type { OrchestratorResult, OrchestratorRun, OrchestratorStep } from '../../ai/types';
import { createNaturalLanguageHandler } from './naturalLanguage';

function step(tool: string, status: OrchestratorStep['status'], result: OrchestratorStep['result']): OrchestratorStep {
  return { tool, args: {}, result, status };
}

function setup(steps: OrchestratorStep[], extra: Partial<OrchestratorResult> = {}) {
  let seen: OrchestratorRun | undefined;
  const handler = createNaturalLanguageHandler({
    buildContext: () => ({ activeApp: 'cmd', snapshot: { app: 'cmd', cwd: 'C:\\X' } }),
    confirm: async () => true,
    run: async (r) => {
      seen = r;
      r.onEvent?.({ type: 'thinking' });
      for (const s of steps) {
        r.onEvent?.({ type: 'tool_start', tool: s.tool, args: s.args });
        r.onEvent?.({ type: 'tool_end', step: s });
      }
      const stoppedBy = extra.stoppedBy ?? 'model_done';
      return { finalText: 'All done.', report: buildReport(steps, stoppedBy), steps, stoppedBy, ...extra };
    },
  });
  return { handler, seen: () => seen };
}

describe('CMD natural-language handler', () => {
  it('prints steps live and a report for success, using cmd context and cwd', async () => {
    const { handler, seen } = setup([step('create_folder', 'ok', ok({ path: 'C:\\X\\AI Projects' }))]);
    const printed: string[] = [];
    const out = await handler('Create a folder called AI Projects', { windowId: 'w', cwd: 'C:\\X', print: (l) => printed.push(l) });
    expect(printed).toEqual(['Thinking...', '  running create_folder...', '  [ok] create_folder C:\\X\\AI Projects']);
    expect(out[0]).toBe('All done.');
    expect(out.join('\n')).toContain('OK create_folder');
    expect(seen()?.context?.activeApp).toBe('cmd');
    expect(seen()?.context?.cwdHint).toBe('C:\\X');
  });

  it('reports failed steps honestly', async () => {
    const { handler } = setup([step('move_node', 'error', err('NOT_FOUND', 'No such file'))]);
    const printed: string[] = [];
    const out = await handler('x', { windowId: 'w', cwd: 'C:\\X', print: (l) => printed.push(l) });
    expect(printed.join('\n')).toContain('[failed] move_node - NOT_FOUND: No such file');
    expect(out.join('\n')).toContain('first failed step: move_node');
  });

  it('reports declined steps', async () => {
    const { handler } = setup([step('delete_node', 'declined', err('DECLINED', 'The user declined this action.'))]);
    const printed: string[] = [];
    const out = await handler('x', { windowId: 'w', cwd: 'C:\\X', print: (l) => printed.push(l) });
    expect(printed.join('\n')).toContain('[declined] delete_node');
    expect(out.join('\n')).toContain('SKIPPED delete_node');
  });

  it('reports a cancelled run', async () => {
    const { handler } = setup([], { stoppedBy: 'aborted', finalText: '' });
    const out = await handler('x', { windowId: 'w', cwd: 'C:\\X', signal: new AbortController().signal });
    expect(out.join('\n')).toContain('cancelled');
  });

  it('prints a clear message when AI is unavailable', async () => {
    const { handler } = setup([], { stoppedBy: 'error', finalText: '', error: { code: 'AI_UNAVAILABLE', message: 'no key' } });
    const out = await handler('x', { windowId: 'w', cwd: 'C:\\X' });
    expect(out.join('\n')).toContain('not available');
  });
});
