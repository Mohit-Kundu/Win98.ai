import { buildAiContext } from '../../ai/context';
import { requestAiConfirmation } from '../../ai/confirm';
import { runOrchestrator } from '../../ai/orchestrator';
import type { OrchestratorResult, OrchestratorRun, OrchestratorStep } from '../../ai/types';
import type { NaturalLanguageHandler } from './context';

export interface NlDeps {
  run: (run: OrchestratorRun) => Promise<OrchestratorResult>;
  confirm: OrchestratorRun['confirm'];
  buildContext: typeof buildAiContext;
}

const defaultDeps: NlDeps = {
  run: (r) => runOrchestrator(r),
  confirm: requestAiConfirmation,
  buildContext: buildAiContext,
};

function shorten(text: string, max = 100): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 3) + '...' : one;
}

/** One line per tool step, derived from the real tool result. */
export function formatStepLine(step: OrchestratorStep): string {
  if (step.status === 'ok') {
    const v = step.result.ok ? (step.result.value as Record<string, unknown> | null) : null;
    const where = v && typeof v === 'object' && typeof v['path'] === 'string' ? ` ${v['path']}` : '';
    return `[ok] ${step.tool}${where}`;
  }
  if (step.status === 'declined') return `[declined] ${step.tool}`;
  const msg = !step.result.ok ? `${step.result.error.code}: ${step.result.error.message}` : 'failed';
  return `[failed] ${step.tool} - ${shorten(msg)}`;
}

/**
 * Creates the CMD natural-language handler. It uses the same Orchestrator as Clippy with `activeApp: 'cmd'`.
 * Live progress goes through `ctx.print`; the returned lines are the final text and the honest report.
 */
export function createNaturalLanguageHandler(overrides: Partial<NlDeps> = {}): NaturalLanguageHandler {
  const deps = { ...defaultDeps, ...overrides };
  return async (instruction, ctx) => {
    const print = ctx.print ?? (() => undefined);
    // The CMD provider reports the live cwd. Fall back to the cwd passed in if the window is not focused.
    const base = deps.buildContext(ctx.windowId);
    const context = {
      ...base,
      activeApp: 'cmd',
      cwdHint: ctx.cwd,
      snapshot: base.snapshot ?? { app: 'cmd', cwd: ctx.cwd },
    };
    const result = await deps.run({
      userText: instruction,
      context,
      confirm: deps.confirm,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      onEvent: (e) => {
        if (e.type === 'thinking') print('Thinking...');
        else if (e.type === 'tool_start') print(`  running ${e.tool}...`);
        else if (e.type === 'tool_end') print(`  ${formatStepLine(e.step)}`);
      },
    });

    const out: string[] = [];
    if (result.finalText.trim()) out.push(...result.finalText.trim().split(/\r?\n/));
    if (result.stoppedBy === 'error' && result.error?.code === 'AI_UNAVAILABLE') {
      out.push('The AI assistant is not available. Check that the server is running and configured for AI.');
      return out;
    }
    if (result.report) out.push(...result.report.split(/\r?\n/));
    return out;
  };
}
