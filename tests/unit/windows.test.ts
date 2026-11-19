import { beforeEach, describe, expect, it } from 'vitest';
import { MIN_H, MIN_W, useWindowStore, zOf } from '../../src/store/windows';

const s = () => useWindowStore.getState();

beforeEach(() => {
  useWindowStore.setState({ windows: {}, order: [], focusedId: null });
});

describe('window store', () => {
  it('opens windows on top and focuses them', () => {
    const a = s().open('paint');
    const b = s().open('cmd');
    expect(s().order).toEqual([a, b]);
    expect(s().focusedId).toBe(b);
    expect(zOf(s().order, b)).toBeGreaterThan(zOf(s().order, a));
  });

  it('focus raises a window', () => {
    const a = s().open('paint');
    s().open('cmd');
    s().focus(a);
    expect(s().focusedId).toBe(a);
    expect(s().order.at(-1)).toBe(a);
  });

  it('minimize moves focus to next non-minimized window; focus restores it', () => {
    const a = s().open('paint');
    const b = s().open('cmd');
    s().minimize(b);
    expect(s().windows[b]?.status).toBe('minimized');
    expect(s().focusedId).toBe(a);
    s().focus(b);
    expect(s().windows[b]?.status).toBe('normal');
    expect(s().focusedId).toBe(b);
  });

  it('focusedId is null when all windows are minimized', () => {
    const a = s().open('paint');
    s().minimize(a);
    expect(s().focusedId).toBeNull();
  });

  it('maximize then restore returns original geometry', () => {
    const a = s().open('paint');
    s().move(a, 100, 90);
    const before = { ...s().windows[a]! };
    s().maximize(a);
    expect(s().windows[a]?.status).toBe('maximized');
    s().restore(a);
    const w = s().windows[a]!;
    expect(w.status).toBe('normal');
    expect([w.x, w.y, w.width, w.height]).toEqual([before.x, before.y, before.width, before.height]);
  });

  it('a minimized maximized window comes back maximized', () => {
    const a = s().open('paint');
    s().maximize(a);
    s().minimize(a);
    s().focus(a);
    expect(s().windows[a]?.status).toBe('maximized');
  });

  it('close leaves other windows unchanged', () => {
    const a = s().open('paint');
    const b = s().open('cmd');
    const c = s().open('wordpad');
    const wa = s().windows[a];
    const wc = s().windows[c];
    s().close(b);
    expect(s().windows[b]).toBeUndefined();
    expect(s().order).toEqual([a, c]);
    expect(s().windows[a]).toEqual(wa);
    expect(s().windows[c]).toEqual(wc);
    expect(s().focusedId).toBe(c);
  });

  it('move updates position', () => {
    const a = s().open('paint');
    s().move(a, 10, 20);
    expect([s().windows[a]?.x, s().windows[a]?.y]).toEqual([10, 20]);
  });

  it('resize clamps to minimum size', () => {
    const a = s().open('paint');
    s().resize(a, 5, -10);
    expect(s().windows[a]?.width).toBe(MIN_W);
    expect(s().windows[a]?.height).toBe(MIN_H);
    s().resize(a, 640, 480, 7, 8);
    const w = s().windows[a]!;
    expect([w.width, w.height, w.x, w.y]).toEqual([640, 480, 7, 8]);
  });

  it('operations on unknown ids are no-ops', () => {
    s().open('paint');
    const snap = s().order.slice();
    s().close('nope');
    s().focus('nope');
    s().minimize('nope');
    s().maximize('nope');
    s().restore('nope');
    s().move('nope', 1, 1);
    s().resize('nope', 1, 1);
    expect(s().order).toEqual(snap);
  });
});
