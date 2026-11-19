import { create } from 'zustand';

export const MIN_W = 200;
export const MIN_H = 120;

export type AppId = string;
export type WindowStatus = 'normal' | 'minimized' | 'maximized';

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState extends Geometry {
  id: string;
  appId: AppId;
  title: string;
  /** Geometry saved while maximized (a minimized window with `prev` was maximized before). */
  prev?: Geometry;
  status: WindowStatus;
  launchArgs?: unknown;
}

export interface WindowStore {
  windows: Record<string, WindowState>;
  /** Z-order source of truth. Last id is the topmost window. */
  order: string[];
  /** Topmost non-minimized window, or null. Always derived from `order` and `windows`. */
  focusedId: string | null;
  open(appId: AppId, opts?: { title?: string; launchArgs?: unknown }): string;
  close(id: string): void;
  focus(id: string): void;
  minimize(id: string): void;
  maximize(id: string): void;
  restore(id: string): void;
  move(id: string, x: number, y: number): void;
  resize(id: string, w: number, h: number, x?: number, y?: number): void;
}

const DEFAULT_SIZE = { width: 480, height: 320 };
const CASCADE_STEP = 24;
const CASCADE_COUNT = 10;

let nextId = 1;

export function deriveFocusedId(windows: Record<string, WindowState>, order: string[]): string | null {
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    if (id !== undefined && windows[id]?.status !== 'minimized') return id;
  }
  return null;
}

/** Z index of a window, derived from `order`. */
export function zOf(order: string[], id: string): number {
  return order.indexOf(id);
}

function clampSize(v: number, min: number): number {
  return Number.isFinite(v) ? Math.max(min, v) : min;
}

function finalize(windows: Record<string, WindowState>, order: string[]) {
  return { windows, order, focusedId: deriveFocusedId(windows, order) };
}

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: {},
  order: [],
  focusedId: null,

  open(appId, opts) {
    const id = `w${nextId++}`;
    const offset = (get().order.length % CASCADE_COUNT) * CASCADE_STEP;
    const win: WindowState = {
      id,
      appId,
      title: opts?.title ?? appId,
      x: 40 + offset,
      y: 40 + offset,
      ...DEFAULT_SIZE,
      status: 'normal',
      launchArgs: opts?.launchArgs,
    };
    set((s) => finalize({ ...s.windows, [id]: win }, [...s.order, id]));
    return id;
  },

  close(id) {
    set((s) => {
      if (!s.windows[id]) return s;
      const windows = { ...s.windows };
      delete windows[id];
      return finalize(windows, s.order.filter((o) => o !== id));
    });
  },

  focus(id) {
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      const windows =
        w.status === 'minimized'
          ? { ...s.windows, [id]: { ...w, status: w.prev ? ('maximized' as const) : ('normal' as const) } }
          : s.windows;
      return finalize(windows, [...s.order.filter((o) => o !== id), id]);
    });
  },

  minimize(id) {
    set((s) => {
      const w = s.windows[id];
      if (!w || w.status === 'minimized') return s;
      return finalize({ ...s.windows, [id]: { ...w, status: 'minimized' } }, s.order);
    });
  },

  maximize(id) {
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      const prev = w.status === 'maximized' ? w.prev : { x: w.x, y: w.y, width: w.width, height: w.height };
      const windows = { ...s.windows, [id]: { ...w, status: 'maximized' as const, prev } };
      return finalize(windows, [...s.order.filter((o) => o !== id), id]);
    });
  },

  restore(id) {
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      let next: WindowState;
      if (w.status === 'minimized' && w.prev) {
        next = { ...w, status: 'maximized' };
      } else {
        const { prev, ...rest } = w;
        next = { ...rest, ...(prev ?? {}), status: 'normal' };
      }
      return finalize({ ...s.windows, [id]: next }, [...s.order.filter((o) => o !== id), id]);
    });
  },

  move(id, x, y) {
    set((s) => {
      const w = s.windows[id];
      if (!w || !Number.isFinite(x) || !Number.isFinite(y)) return s;
      return { windows: { ...s.windows, [id]: { ...w, x, y } } };
    });
  },

  resize(id, w, h, x, y) {
    set((s) => {
      const win = s.windows[id];
      if (!win) return s;
      const next: WindowState = {
        ...win,
        width: clampSize(w, MIN_W),
        height: clampSize(h, MIN_H),
        x: x !== undefined && Number.isFinite(x) ? x : win.x,
        y: y !== undefined && Number.isFinite(y) ? y : win.y,
      };
      return { windows: { ...s.windows, [id]: next } };
    });
  },
}));
