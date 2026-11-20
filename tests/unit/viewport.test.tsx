import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowStore } from '../../src/store/windows';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary';

const TASKBAR_H = 28;
const VIEWPORTS = [
  [1024, 768],
  [1366, 768],
  [1920, 1080],
] as const;

describe('viewport usability (Requirement 1.11)', () => {
  beforeEach(() => useWindowStore.setState({ windows: {}, order: [], focusedId: null }));

  it.each(VIEWPORTS)('cascaded default windows stay inside the workspace at %ix%i', (vw, vh) => {
    const { open } = useWindowStore.getState();
    for (let i = 0; i < 25; i++) open('explorer');
    const { windows } = useWindowStore.getState();
    for (const w of Object.values(windows)) {
      expect(w.x + w.width).toBeLessThanOrEqual(vw);
      expect(w.y + w.height).toBeLessThanOrEqual(vh - TASKBAR_H);
    }
  });
});

describe('error boundaries (Requirement 1.11)', () => {
  afterEach(cleanup);

  it('shows a contained error with Close, leaving siblings rendered', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onDismiss = vi.fn();
    const Boom = () => {
      throw new Error('kaput');
    };
    render(
      <div>
        <p>sibling</p>
        <ErrorBoundary label="Paint" onDismiss={onDismiss}>
          <Boom />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Paint stopped working: kaput');
    expect(screen.getByText('sibling')).toBeTruthy();
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
