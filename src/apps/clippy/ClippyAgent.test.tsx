import { StrictMode } from 'react';
import { render, waitFor, act } from '@testing-library/react';
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agents: Array<ReturnType<typeof makeAgent>> = [];
function makeAgent() {
  return {
    _el: document.createElement('div'),
    show: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
}

vi.mock('clippyjs', () => ({
  initAgent: vi.fn(async () => {
    const a = makeAgent();
    agents.push(a);
    return a;
  }),
}));

import { initAgent } from 'clippyjs';
import { ClippyAgent } from './ClippyAgent';

const a0 = () => agents[0] as ReturnType<typeof makeAgent>;

beforeEach(() => {
  agents.length = 0;
});

describe('ClippyAgent', () => {
  it('maps states to animations', async () => {
    const { rerender } = render(<ClippyAgent state="idle" />);
    await waitFor(() => expect(a0().show).toHaveBeenCalled());
    expect(a0().play).not.toHaveBeenCalled();
    rerender(<ClippyAgent state="thinking" />);
    expect(a0().play).toHaveBeenCalledWith('Thinking', expect.any(Number));
    rerender(<ClippyAgent state="speaking" />);
    expect(a0().play).toHaveBeenCalledWith('Explain', expect.any(Number));
  });

  it('calls onClick on a click without drag', async () => {
    const onClick = vi.fn();
    render(<ClippyAgent state="idle" onClick={onClick} />);
    await waitFor(() => expect(a0().show).toHaveBeenCalled());
    const el = a0()._el;
    act(() => {
      el.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10 }));
      el.dispatchEvent(new MouseEvent('mouseup', { clientX: 11, clientY: 10 }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    act(() => {
      el.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10 }));
      el.dispatchEvent(new MouseEvent('mouseup', { clientX: 80, clientY: 50 }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('places the agent bottom-right above the taskbar with the right z-index', async () => {
    vi.mocked(initAgent).mockImplementationOnce((async () => {
      const a = makeAgent();
      Object.defineProperty(a._el, 'offsetWidth', { value: 124 });
      Object.defineProperty(a._el, 'offsetHeight', { value: 93 });
      agents.push(a);
      return a;
    }) as unknown as typeof initAgent);
    Object.assign(window, { innerWidth: 1280, innerHeight: 720 });
    const onStatus = vi.fn();
    render(<ClippyAgent state="idle" onStatus={onStatus} />);
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith('ready'));
    const el = a0()._el;
    expect(el.style.left).toBe(`${1280 - 124 - 8}px`);
    expect(el.style.top).toBe(`${720 - 93 - 28 - 8}px`);
    expect(el.style.zIndex).toBe('99992');
  });

  it('keeps the placed rect inside the viewport above the taskbar for any viewport', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 140, max: 3000 }), fc.integer({ min: 140, max: 2000 }), async (w, h) => {
        agents.length = 0;
        vi.mocked(initAgent).mockImplementationOnce((async () => {
          const a = makeAgent();
          Object.defineProperty(a._el, 'offsetWidth', { value: 124 });
          Object.defineProperty(a._el, 'offsetHeight', { value: 93 });
          agents.push(a);
          return a;
        }) as unknown as typeof initAgent);
        Object.assign(window, { innerWidth: w, innerHeight: h });
        const onStatus = vi.fn();
        const { unmount } = render(<ClippyAgent state="idle" onStatus={onStatus} />);
        await waitFor(() => expect(onStatus).toHaveBeenCalledWith('ready'));
        const left = parseFloat(a0()._el.style.left);
        const top = parseFloat(a0()._el.style.top);
        unmount();
        return left >= 0 && top >= 0 && left + 124 <= w && top + 93 <= h - 28;
      }),
      { numRuns: 25 },
    );
  });

  it('reports failed and logs when initAgent rejects', async () => {
    vi.mocked(initAgent).mockRejectedValueOnce(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onStatus = vi.fn();
    render(<ClippyAgent state="idle" onStatus={onStatus} />);
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith('failed'));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('disposes on unmount and leaves one live agent under StrictMode', async () => {
    const { unmount } = render(
      <StrictMode>
        <ClippyAgent state="idle" />
      </StrictMode>,
    );
    await waitFor(() => expect(agents.length).toBe(2));
    await waitFor(() => expect(agents.filter((a) => a.show.mock.calls.length > 0).length).toBe(1));
    const live = agents.filter((a) => a.dispose.mock.calls.length === 0);
    expect(live.length).toBe(1);
    unmount();
    expect(live[0]?.dispose).toHaveBeenCalledTimes(1);
  });
});
