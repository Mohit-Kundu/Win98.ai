import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerApp, unregisterApp } from '../../src/desktop/appRegistry';
import { Desktop } from '../../src/desktop/Desktop';
import { useWindowStore } from '../../src/store/windows';

function Hello() {
  return <p>hello body</p>;
}
function Boom(): never {
  throw new Error('kaboom');
}

beforeEach(() => {
  useWindowStore.setState({ windows: {}, order: [], focusedId: null });
  registerApp({ id: 'test-hello', title: 'Hello', icon: 'document', component: Hello, fileExtensions: [], singleInstance: false });
  registerApp({ id: 'test-boom', title: 'Boom', icon: 'app', component: Boom, fileExtensions: [], singleInstance: false });
});

afterEach(() => {
  cleanup();
  unregisterApp('test-hello');
  unregisterApp('test-boom');
});

describe('desktop shell', () => {
  it('renders with an empty registry', () => {
    unregisterApp('test-hello');
    unregisterApp('test-boom');
    render(<Desktop />);
    expect(screen.getByRole('toolbar', { name: 'Taskbar' })).toBeTruthy();
    expect(screen.getByRole('timer')).toBeTruthy();
  });

  it('launches from a desktop icon double-click and from the Start menu', () => {
    render(<Desktop />);
    fireEvent.doubleClick(screen.getByText('Hello', { selector: '.desktop-icon span' }));
    expect(Object.keys(useWindowStore.getState().windows)).toHaveLength(1);
    fireEvent.click(screen.getByText('Start'));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Hello' }));
    expect(Object.keys(useWindowStore.getState().windows)).toHaveLength(2);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('taskbar button restores and focuses a minimized window', () => {
    render(<Desktop />);
    let id = '';
    act(() => {
      id = useWindowStore.getState().open('test-hello', { title: 'Hello' });
      useWindowStore.getState().minimize(id);
    });
    const btn = screen.getByRole('button', { name: /Hello/, pressed: false });
    fireEvent.click(btn);
    const s = useWindowStore.getState();
    expect(s.windows[id]?.status).toBe('normal');
    expect(s.focusedId).toBe(id);
    expect(screen.getByRole('button', { name: /Hello/, pressed: true })).toBeTruthy();
  });

  it('a crashing app is contained in its window', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Desktop />);
    act(() => {
      useWindowStore.getState().open('test-hello', { title: 'Hello' });
      useWindowStore.getState().open('test-boom', { title: 'Boom' });
    });
    expect(screen.getByRole('alert').textContent).toContain('kaboom');
    expect(screen.getByText('hello body')).toBeTruthy();
    spy.mockRestore();
  });
});
