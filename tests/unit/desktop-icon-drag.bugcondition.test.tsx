/**
 * Bug condition exploration test: desktop icons do not move or persist.
 * Property 1: Bug Condition. MUST FAIL on unfixed code.
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5**
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerApp, unregisterApp } from '../../src/desktop/appRegistry';
import { Desktop } from '../../src/desktop/Desktop';
import { useWindowStore } from '../../src/store/windows';

const CELL_W = 84;
const CELL_H = 78;
const PAD = 8;
const KEY = 'win98.desktopIconCells';
const IDS = ['bug-a', 'bug-b', 'bug-c'];
const TITLES: Record<string, string> = { 'bug-a': 'AAA', 'bug-b': 'BBB', 'bug-c': 'CCC' };

type Cell = { col: number; row: number };

const cssText = readFileSync(resolve(process.cwd(), 'src/desktop/desktop.css'), 'utf8');
let styleEl: HTMLStyleElement;

function Stub() {
  return null;
}

beforeEach(() => {
  localStorage.clear();
  useWindowStore.setState({ windows: {}, order: [], focusedId: null });
  for (const id of IDS) {
    registerApp({ id, title: TITLES[id]!, icon: 'document', component: Stub, fileExtensions: [], singleInstance: false });
  }
  // Vitest does not apply plain CSS imports, so load the real stylesheet into jsdom.
  styleEl = document.createElement('style');
  styleEl.textContent = cssText;
  document.head.appendChild(styleEl);
  // jsdom lacks pointer capture.
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
});

afterEach(() => {
  cleanup();
  styleEl.remove();
  for (const id of IDS) unregisterApp(id);
  localStorage.clear();
});

function grid() {
  return {
    cols: Math.max(1, Math.floor((window.innerWidth - PAD) / CELL_W)),
    rows: Math.max(1, Math.floor((window.innerHeight - 28 - PAD) / CELL_H)),
  };
}

function iconEl(container: HTMLElement, id: string): HTMLElement {
  const title = TITLES[id];
  const el = Array.from(container.querySelectorAll<HTMLElement>('.desktop-icon')).find(
    (b) => b.textContent === title,
  );
  if (!el) throw new Error(`icon ${id} not rendered`);
  return el;
}

function cellOf(el: HTMLElement): Cell {
  return {
    col: Math.round((parseFloat(el.style.left) - PAD) / CELL_W),
    row: Math.round((parseFloat(el.style.top) - PAD) / CELL_H),
  };
}

function seed(cells: Record<string, Cell>) {
  localStorage.setItem(KEY, JSON.stringify(cells));
}

function stored(): Record<string, Cell> {
  return JSON.parse(localStorage.getItem(KEY) ?? '{}');
}

function drag(el: HTMLElement, from: Cell, dCols: number, dRows: number) {
  const x0 = PAD + from.col * CELL_W + 20;
  const y0 = PAD + from.row * CELL_H + 20;
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: x0, clientY: y0 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x0 + (dCols * CELL_W) / 2, clientY: y0 + (dRows * CELL_H) / 2 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x0 + dCols * CELL_W, clientY: y0 + dRows * CELL_H });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x0 + dCols * CELL_W, clientY: y0 + dRows * CELL_H });
}

const distinct = (cells: Cell[]) => new Set(cells.map((c) => `${c.col},${c.row}`)).size === cells.length;

describe('Property 1: Bug Condition - desktop icons do not move or persist', () => {
  it('icons are absolutely positioned (computed style)', () => {
    const { container } = render(<Desktop />);
    for (const id of IDS) {
      expect(getComputedStyle(iconEl(container, id)).position).toBe('absolute');
    }
  });

  it('honors every valid saved cell {A:(0,0), B:(2,1), C:(3,0)}', () => {
    const saved = { 'bug-a': { col: 0, row: 0 }, 'bug-b': { col: 2, row: 1 }, 'bug-c': { col: 3, row: 0 } };
    seed(saved);
    const { container } = render(<Desktop />);
    for (const id of IDS) {
      const el = iconEl(container, id);
      expect(el.style.left).toBe(`${PAD + saved[id as keyof typeof saved].col * CELL_W}px`);
      expect(el.style.top).toBe(`${PAD + saved[id as keyof typeof saved].row * CELL_H}px`);
    }
  });

  it('drag by several cells stores nearestFreeCell(snap(drop)) and cells stay distinct', () => {
    seed({ 'bug-a': { col: 0, row: 0 }, 'bug-b': { col: 2, row: 1 }, 'bug-c': { col: 3, row: 0 } });
    const { container } = render(<Desktop />);
    drag(iconEl(container, 'bug-c'), { col: 3, row: 0 }, 2, 1);
    const s = stored();
    expect(s['bug-c']).toEqual({ col: 5, row: 1 });
    expect(s['bug-a']).toEqual({ col: 0, row: 0 });
    expect(s['bug-b']).toEqual({ col: 2, row: 1 });
    expect(distinct(Object.values(s))).toBe(true);
  });

  it('dropping on an occupied cell lands in a different, nearest free cell', () => {
    seed({ 'bug-a': { col: 0, row: 0 }, 'bug-b': { col: 2, row: 1 }, 'bug-c': { col: 3, row: 0 } });
    const { container } = render(<Desktop />);
    drag(iconEl(container, 'bug-a'), { col: 0, row: 0 }, 2, 1); // target (2,1) is B's cell
    const s = stored();
    const a = s['bug-a']!;
    expect(a).toBeDefined();
    expect(a).not.toEqual({ col: 2, row: 1 });
    expect((a.col - 2) ** 2 + (a.row - 1) ** 2).toBe(1); // nearest free ring
    expect(distinct(Object.values(s))).toBe(true);
  });

  it('property: any drag >= 4px ends in a distinct, in-range, nearest free cell', () => {
    fc.assert(
      fc.property(fc.integer({ min: -3, max: 6 }), fc.integer({ min: -2, max: 4 }), (dc, dr) => {
        fc.pre(dc !== 0 || dr !== 0);
        cleanup();
        localStorage.clear();
        seed({ 'bug-a': { col: 0, row: 0 }, 'bug-b': { col: 2, row: 1 }, 'bug-c': { col: 3, row: 0 } });
        const { container } = render(<Desktop />);
        drag(iconEl(container, 'bug-c'), { col: 3, row: 0 }, dc, dr);
        const { cols, rows } = grid();
        const tc = Math.min(cols - 1, Math.max(0, 3 + dc));
        const tr = Math.min(rows - 1, Math.max(0, 0 + dr));
        const s = stored();
        const c = s['bug-c'];
        if (!c) return false;
        const others = [s['bug-a']!, s['bug-b']!];
        const occupied = others.some((o) => o.col === tc && o.row === tr);
        const dist = (c.col - tc) ** 2 + (c.row - tr) ** 2;
        return distinct([...others, c]) && (occupied ? dist === 1 : dist === 0);
      }),
      { numRuns: 15 },
    );
  });
});
