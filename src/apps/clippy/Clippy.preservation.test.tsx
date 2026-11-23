/**
 * Preservation property tests (clippy-avatar-instead-of-button, Property 2).
 * Observed on unfixed code; must keep passing after the fix.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrchestratorResult, OrchestratorRun } from '../../ai/types';
import { useWindowStore } from '../../store/windows';

interface FakeAgent {
  _el: HTMLElement;
  show: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}
const agents: FakeAgent[] = [];
let lastLoaders: Record<string, () => Promise<{ default: unknown }>> | undefined;

vi.mock('clippyjs', () => ({
  initAgent: vi.fn(async (loaders: Record<string, () => Promise<{ default: unknown }>>) => {
    lastLoaders = loaders;
    const a: FakeAgent = {
      _el: document.createElement('div'),
      show: vi.fn(),
      play: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
    };
    agents.push(a);
    return a;
  }),
}));

import { Clippy } from './Clippy';
import { ClippyAgent, type ClippyState } from './ClippyAgent';
import { useChatStore } from './chatStore';

const FC = { numRuns: 25 };

beforeEach(() => {
  agents.length = 0;
  lastLoaders = undefined;
  useChatStore.getState().reset();
  useWindowStore.setState({ windows: {}, order: [], focusedId: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Preservation: drag vs click (3.5)', () => {
  it('**Validates: Requirements 3.5** click fires only when movement is under 4px', async () => {
    const onClick = vi.fn();
    render(<ClippyAgent state="idle" onClick={onClick} />);
    await waitFor(() => expect(agents[0]?.show).toHaveBeenCalled());
    const el = (agents[0] as FakeAgent)._el;
    fc.assert(
      fc.property(fc.integer({ min: -60, max: 60 }), fc.integer({ min: -60, max: 60 }), (dx, dy) => {
        onClick.mockClear();
        act(() => {
          el.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
          el.dispatchEvent(new MouseEvent('mouseup', { clientX: 100 + dx, clientY: 100 + dy }));
        });
        expect(onClick).toHaveBeenCalledTimes(Math.hypot(dx, dy) < 4 ? 1 : 0);
      }),
      FC,
    );
  });

  it('**Validates: Requirements 3.5** dragging the character never toggles the chat', async () => {
    render(<Clippy deps={{ buildContext: () => ({}) }} />);
    await waitFor(() => expect(agents[0]?.show).toHaveBeenCalled());
    const el = (agents[0] as FakeAgent)._el;
    act(() => {
      el.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10 }));
      el.dispatchEvent(new MouseEvent('mouseup', { clientX: 90, clientY: 60 }));
    });
    expect(useChatStore.getState().open).toBe(false);
    act(() => {
      el.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10 }));
      el.dispatchEvent(new MouseEvent('mouseup', { clientX: 11, clientY: 10 }));
    });
    expect(useChatStore.getState().open).toBe(true);
  });
});

describe('Preservation: animation mapping (3.3)', () => {
  it('**Validates: Requirements 3.3** thinking plays Thinking, speaking plays Explain, idle plays nothing', async () => {
    const phases: ClippyState[] = ['idle', 'thinking', 'speaking'];
    const { rerender } = render(<ClippyAgent state="idle" />);
    await waitFor(() => expect(agents[0]?.show).toHaveBeenCalled());
    const agent = agents[0] as FakeAgent;
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...phases), async (phase) => {
        agent.play.mockClear();
        agent.stop.mockClear();
        // Move off the target phase first so the effect re-runs.
        rerender(<ClippyAgent state={phase === 'idle' ? 'thinking' : 'idle'} />);
        agent.play.mockClear();
        agent.stop.mockClear();
        rerender(<ClippyAgent state={phase} />);
        expect(agent.stop).toHaveBeenCalled();
        const played = agent.play.mock.calls.map((c) => c[0]);
        if (phase === 'thinking') expect(played).toEqual(['Thinking']);
        else if (phase === 'speaking') expect(played).toEqual(['Explain']);
        else expect(played).toEqual([]);
      }),
      FC,
    );
  });

  it('**Validates: Requirements 3.3** sending a message goes thinking -> speaking -> idle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seen: string[] = [];
    const unsub = useChatStore.subscribe((s) => {
      if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
    });
    useChatStore.getState().setOpen(true);
    const run = vi.fn(async (): Promise<OrchestratorResult> => ({ finalText: 'ok', report: 'r', steps: [], stoppedBy: 'model_done' }));
    render(<Clippy deps={{ run, buildContext: () => ({}) }} />);
    fireEvent.change(screen.getByTestId('clippy-input'), { target: { value: 'make me a folder' } });
    fireEvent.click(screen.getByTestId('clippy-send'));
    await waitFor(() => expect(useChatStore.getState().phase).toBe('speaking'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(useChatStore.getState().phase).toBe('idle');
    unsub();
    expect(seen).toEqual(expect.arrayContaining(['thinking', 'speaking', 'idle']));
  });
});

describe('Preservation: chat flow and test ids (3.1, 3.2, 3.4)', () => {
  it('**Validates: Requirements 3.1, 3.2, 3.4** any message runs the orchestrator and shows message, report; focus unchanged', async () => {
    useChatStore.getState().setOpen(true);
    useWindowStore.setState({ windows: {}, order: [], focusedId: 'w-focus' });
    const run = vi.fn(async (r: OrchestratorRun): Promise<OrchestratorResult> => {
      return { finalText: `echo ${r.userText}`, report: 'Completed.', steps: [], stoppedBy: 'model_done' };
    });
    render(<Clippy deps={{ run, buildContext: () => ({}) }} />);
    expect(screen.getByTestId('clippy-chat')).toBeTruthy();
    expect(screen.getByTestId('clippy-input')).toBeTruthy();
    expect(screen.getByTestId('clippy-send')).toBeTruthy();

    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z]{1,12}$/), async (word) => {
        const before = run.mock.calls.length;
        fireEvent.change(screen.getByTestId('clippy-input'), { target: { value: word } });
        fireEvent.click(screen.getByTestId('clippy-send'));
        await waitFor(() => expect(run.mock.calls.length).toBe(before + 1));
        const call = run.mock.calls[before]?.[0] as OrchestratorRun;
        expect(call.userText).toBe(word);
        await waitFor(() => expect(screen.queryByTestId('clippy-running')).toBeNull());
        expect(screen.getAllByTestId('clippy-message').length).toBe((before + 1) * 2);
        expect(screen.getAllByTestId('clippy-report').length).toBe(before + 1);
        expect(useWindowStore.getState().focusedId).toBe('w-focus');
      }),
      { numRuns: 8 },
    );
  });

  it('**Validates: Requirements 3.2** steps and cancel render with their test ids', async () => {
    useChatStore.getState().setOpen(true);
    let release!: () => void;
    const run = vi.fn(
      (r: OrchestratorRun) =>
        new Promise<OrchestratorResult>((resolve) => {
          r.onEvent?.({ type: 'tool_start', tool: 'list_files' } as never);
          release = () => resolve({ finalText: '', report: 'done', steps: [], stoppedBy: 'model_done' });
        }),
    );
    render(<Clippy deps={{ run, buildContext: () => ({}) }} />);
    fireEvent.change(screen.getByTestId('clippy-input'), { target: { value: 'go' } });
    fireEvent.click(screen.getByTestId('clippy-send'));
    await waitFor(() => expect(screen.getByTestId('clippy-cancel')).toBeTruthy());
    expect(screen.getAllByTestId('clippy-step').length).toBe(1);
    await act(async () => release());
    await waitFor(() => expect(screen.queryByTestId('clippy-cancel')).toBeNull());
  });
});

describe('Preservation: local assets (3.6)', () => {
  it('**Validates: Requirements 3.6** every loader requests only same-origin /clippy/ paths', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        urls.push(String(u));
        return { json: async () => ({}) } as Response;
      }),
    );
    render(<ClippyAgent state="idle" />);
    await waitFor(() => expect(lastLoaders).toBeDefined());
    const l = lastLoaders as Record<string, () => Promise<{ default: unknown }>>;
    const map = (await l['map']!()).default as string;
    await l['agent']!();
    await l['sound']!();
    for (const u of [...urls, map]) {
      expect(u.startsWith('/clippy/')).toBe(true);
      expect(/^[a-z]+:\/\//i.test(u)).toBe(false);
    }
    expect(urls.sort()).toEqual(['/clippy/agent.json', '/clippy/sounds.json']);
  });
});
