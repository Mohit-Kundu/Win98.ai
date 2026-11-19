import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { HistoryStack } from './history';

describe('HistoryStack', () => {
  it('starts with nothing to undo or redo', () => {
    const h = new HistoryStack('a');
    expect(h.current).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeUndefined();
    expect(h.redo()).toBeUndefined();
  });

  it('undoes and redoes in order', () => {
    const h = new HistoryStack(0);
    h.push(1);
    h.push(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.redo()).toBe(1);
    expect(h.redo()).toBe(2);
  });

  it('drops redo states when a new state is pushed', () => {
    const h = new HistoryStack(0);
    h.push(1);
    h.undo();
    h.push(5);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(0);
  });

  it('keeps at most `capacity` undo steps', () => {
    const h = new HistoryStack(0, 3);
    for (let i = 1; i <= 10; i++) h.push(i);
    expect(h.undoDepth).toBe(3);
    h.undo();
    h.undo();
    expect(h.undo()).toBe(7);
    expect(h.canUndo).toBe(false);
  });

  it('reset clears history', () => {
    const h = new HistoryStack(0);
    h.push(1);
    h.reset(9);
    expect(h.current).toBe(9);
    expect(h.canUndo).toBe(false);
  });

  it('rejects an invalid capacity', () => {
    expect(() => new HistoryStack(0, 0)).toThrow(RangeError);
  });

  it('restores initial and final state after up to 50 steps', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: 0, maxLength: 50 }), (ops) => {
        const h = new HistoryStack<number>(-1);
        ops.forEach((o) => h.push(o));
        ops.forEach(() => h.undo());
        expect(h.current).toBe(-1);
        ops.forEach(() => h.redo());
        expect(h.current).toBe(ops.length ? ops[ops.length - 1] : -1);
      }),
    );
  });
});
