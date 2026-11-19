import { StrictMode } from 'react';
import { render, waitFor, act } from '@testing-library/react';
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
