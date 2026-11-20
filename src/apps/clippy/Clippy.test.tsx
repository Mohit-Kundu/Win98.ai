import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatRequest, ChatResponse } from '../../../shared/api-contracts';
import { err, ok, type Result } from '../../../shared/errors';
import { AiConfirmHost, requestAiConfirmation } from '../../ai/confirm';
import { registerContextProvider } from '../../ai/context';
import { runOrchestrator } from '../../ai/orchestrator';
import { ToolRegistry, defineTool, type ToolActions } from '../../ai/registry';
import type { OrchestratorResult, OrchestratorRun, OrchestratorStep } from '../../ai/types';
import { useWindowStore } from '../../store/windows';

vi.mock('clippyjs', () => ({
  initAgent: vi.fn(async () => ({
    show: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    _el: document.createElement('div'),
  })),
}));

import { Clippy } from './Clippy';
import { useChatStore } from './chatStore';

const step = (tool: string, status: OrchestratorStep['status'], result: Result<unknown>): OrchestratorStep => ({
  tool,
  args: {},
  result,
  status,
});

function result(over: Partial<OrchestratorResult> = {}): OrchestratorResult {
  return { finalText: 'All done!', report: 'Completed: nothing.', steps: [], stoppedBy: 'model_done', ...over };
}

async function sendMessage(text: string) {
  fireEvent.change(screen.getByTestId('clippy-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('clippy-send'));
}

beforeEach(() => {
  useChatStore.getState().reset();
  useChatStore.getState().setOpen(true);
  useWindowStore.setState({ windows: {}, order: [], focusedId: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Clippy fallback button', () => {
  it('hides clippy-toggle once the agent is ready', async () => {
    const { initAgent } = await import('clippyjs');
    render(<Clippy deps={{ buildContext: () => ({}) }} />);
    await waitFor(() => expect(initAgent).toHaveBeenCalled());
    // The mocked agent element is detached, so let the init promise settle instead.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByTestId('clippy-toggle')).toBeNull();
  });

  it('shows clippy-toggle when the agent fails to load, and it opens the chat', async () => {
    const { initAgent } = await import('clippyjs');
    vi.mocked(initAgent).mockRejectedValueOnce(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useChatStore.getState().setOpen(false);
    render(<Clippy deps={{ buildContext: () => ({}) }} />);
    const toggle = await screen.findByTestId('clippy-toggle');
    expect(spy).toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(screen.getByTestId('clippy-chat')).toBeTruthy();
    spy.mockRestore();
  });
});

describe('Clippy chat', () => {
  it('keeps session history and passes prior turns to the next run', async () => {
    const runs: OrchestratorRun[] = [];
    const run = vi.fn(async (r: OrchestratorRun) => {
      runs.push(r);
      return result({ finalText: `reply ${runs.length}` });
    });
    render(<Clippy deps={{ run, buildContext: () => ({}) }} />);
    await sendMessage('first');
    await waitFor(() => expect(screen.getAllByTestId('clippy-message')).toHaveLength(2));
    await sendMessage('second');
    await waitFor(() => expect(screen.getAllByTestId('clippy-message')).toHaveLength(4));
    expect(runs[0]?.history).toEqual([]);
    expect(runs[1]?.history?.[0]).toEqual({ role: 'user', text: 'first' });
    expect(runs[1]?.history?.[1]?.text).toContain('reply 1');
    expect(screen.getAllByTestId('clippy-message')[3]?.textContent).toContain('reply 2');
  });

  it('shows per-step status lines and an honest summary on partial failure', async () => {
    const okStep = step('create_folder', 'ok', ok({ path: 'C:\\A' }));
    const badStep = step('create_document', 'error', err('WRITE_FAILED', 'disk full'));
    const seenLive: string[] = [];
    const run = async (r: OrchestratorRun) => {
      r.onEvent?.({ type: 'tool_start', tool: 'create_folder', args: {} });
      r.onEvent?.({ type: 'tool_end', step: okStep });
      r.onEvent?.({ type: 'tool_start', tool: 'create_document', args: {} });
      seenLive.push(useChatStore.getState().liveSteps.map((l) => l.status).join(','));
      r.onEvent?.({ type: 'tool_end', step: badStep });
      return result({
        finalText: 'Everything worked perfectly!',
        report: 'Completed (1):\n  OK create_folder (C:\\A)\nFailed (1), first failed step: create_document\n  FAILED create_document (WRITE_FAILED: disk full)',
        steps: [okStep, badStep],
      });
    };
    render(<Clippy deps={{ run, buildContext: () => ({}) }} />);
    await sendMessage('do things');
    await waitFor(() => expect(screen.getByTestId('clippy-report')).toBeTruthy());
    expect(seenLive).toEqual(['ok,running']);
    const steps = screen.getAllByTestId('clippy-step');
    expect(steps.map((e) => e.getAttribute('data-status'))).toEqual(['ok', 'failed']);
    expect(steps[1]?.textContent).toContain('WRITE_FAILED');
    // The report comes from steps and is shown next to the model's claim.
    expect(screen.getByTestId('clippy-report').textContent).toContain('first failed step: create_document');
  });

  it('renders model text as text, not HTML', async () => {
    const run = async () => result({ finalText: '<img src=x onerror=alert(1)><b>hi</b>' });
    const { container } = render(<Clippy deps={{ run, buildContext: () => ({}) }} />);
    await sendMessage('x');
    await waitFor(() => expect(screen.getAllByTestId('clippy-message')).toHaveLength(2));
    expect(container.querySelector('.clippy-chat img')).toBeNull();
    expect(screen.getAllByTestId('clippy-message')[1]?.textContent).toContain('<img src=x');
  });

  it('cancel aborts the run', async () => {
    let signal: AbortSignal | undefined;
    const run = (r: OrchestratorRun) =>
      new Promise<OrchestratorResult>((resolve) => {
        signal = r.signal;
        r.signal?.addEventListener('abort', () =>
          resolve(result({ finalText: '', report: 'Stopped: the request was cancelled.', stoppedBy: 'aborted' })),
        );
      });
    render(<Clippy deps={{ run, buildContext: () => ({}) }} />);
    await sendMessage('long task');
    fireEvent.click(await screen.findByTestId('clippy-cancel'));
    await waitFor(() => expect(screen.getByTestId('clippy-report').textContent).toContain('cancelled'));
    expect(signal?.aborted).toBe(true);
    expect(useChatStore.getState().running).toBe(false);
  });

  it('thinking while running, speaking briefly, then idle', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const run = () =>
      new Promise<OrchestratorResult>((resolve) => {
        release = () => resolve(result());
      });
    render(<Clippy deps={{ run, buildContext: () => ({}) }} />);
    sendMessage('hi');
    await act(async () => {});
    expect(useChatStore.getState().phase).toBe('thinking');
    await act(async () => release());
    expect(useChatStore.getState().phase).toBe('speaking');
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    expect(useChatStore.getState().phase).toBe('idle');
  });

  it('captures context from the focused app window at send time, not the chat', async () => {
    let appWin = '';
    act(() => {
      appWin = useWindowStore.getState().open('wordpad');
    });
    registerContextProvider({ appId: 'wordpad', windowId: appWin, describe: () => ({ app: 'wordpad', path: 'C:\\a.wpd' }) });
    const run = vi.fn<(r: OrchestratorRun) => Promise<OrchestratorResult>>(async () => result());
    render(<Clippy deps={{ run }} />);
    // Interacting with the chat must not change the focused window.
    fireEvent.mouseDown(screen.getByTestId('clippy-chat'));
    await sendMessage('rewrite this');
    await waitFor(() => expect(run).toHaveBeenCalled());
    const ctx = run.mock.calls[0]?.[0].context;
    expect(ctx?.activeApp).toBe('wordpad');
    expect(ctx?.snapshot).toEqual({ app: 'wordpad', path: 'C:\\a.wpd' });
    expect(useWindowStore.getState().focusedId).toBe(appWin);
  });

  it('exposes tools per active app and always exposes general tools', async () => {
    const reg = new ToolRegistry();
    const noop = async () => ok({});
    reg.register(defineTool({ name: 'general_tool', description: 'g', input: z.object({}), handler: noop }));
    reg.register(defineTool({ name: 'paint_tool', description: 'p', input: z.object({}), appScope: ['paint'], handler: noop }));
    reg.register(defineTool({ name: 'cmd_tool', description: 'c', input: z.object({}), appScope: ['cmd'], handler: noop }));
    const seen: ChatRequest[] = [];
    const client = {
      chat: async (req: ChatRequest): Promise<Result<ChatResponse>> => {
        seen.push(req);
        return ok({ modelContent: { role: 'model', parts: [{ text: 'ok' }] }, text: 'ok', functionCalls: [] });
      },
    };
    const run = (r: OrchestratorRun) => runOrchestrator(r, { client, registry: reg, actions: {} as ToolActions });

    const { unmount } = render(<Clippy deps={{ run, buildContext: () => ({ activeApp: 'paint' }) }} />);
    await sendMessage('a');
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.tools?.map((t) => t.name).sort()).toEqual(['general_tool', 'paint_tool']);
    unmount();

    useChatStore.getState().reset();
    useChatStore.getState().setOpen(true);
    render(<Clippy deps={{ run, buildContext: () => ({ activeApp: 'wordpad' }) }} />);
    await sendMessage('b');
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]?.tools?.map((t) => t.name)).toEqual(['general_tool']);
  });

  it('asks for confirmation before a destructive tool and honors a decline', async () => {
    const handler = vi.fn(async () => ok({}));
    const reg = new ToolRegistry();
    reg.register(
      defineTool({
        name: 'delete_thing',
        description: 'd',
        input: z.object({}),
        destructive: true,
        describeForConfirm: () => 'Delete the thing?',
        handler,
      }),
    );
    let round = 0;
    const client = {
      chat: async (): Promise<Result<ChatResponse>> =>
        round++ === 0
          ? ok({
              modelContent: { role: 'model', parts: [{ functionCall: { name: 'delete_thing', args: {} } }] },
              functionCalls: [{ name: 'delete_thing', args: {} }],
            })
          : ok({ modelContent: { role: 'model', parts: [{ text: 'Deleted it.' }] }, text: 'Deleted it.', functionCalls: [] }),
    };
    const run = (r: OrchestratorRun) => runOrchestrator(r, { client, registry: reg, actions: {} as ToolActions });
    render(
      <>
        <Clippy deps={{ run, confirm: requestAiConfirmation, buildContext: () => ({}) }} />
        <AiConfirmHost />
      </>,
    );
    await sendMessage('delete it');
    const dialog = await screen.findByRole('dialog', { name: 'Confirm assistant action' });
    expect(within(dialog).getByText('Delete the thing?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'No' }));
    await waitFor(() => expect(screen.getByTestId('clippy-report')).toBeTruthy());
    expect(handler).not.toHaveBeenCalled();
    expect(screen.getByTestId('clippy-step').getAttribute('data-status')).toBe('declined');
    expect(screen.getByTestId('clippy-report').textContent).not.toMatch(/OK delete_thing/);
    expect(screen.getByTestId('clippy-report').textContent).toContain('SKIPPED delete_thing');
  });
});
