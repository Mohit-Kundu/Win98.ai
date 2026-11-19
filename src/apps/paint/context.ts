/**
 * Hook point for Paint's Context_Provider. Task 7.10 wires `getPaintContext`
 * into the shared context registry. Paint itself only registers its getter here.
 */
export interface PaintContextSnapshot {
  app: 'paint';
  fileId?: string;
  path?: string;
  dirty: boolean;
  width: number;
  height: number;
}

type Getter = () => PaintContextSnapshot;

const getters = new Map<string, Getter>();

/** Called by a Paint window on mount. Returns an unregister function. */
export function registerPaintContext(windowId: string, getter: Getter): () => void {
  getters.set(windowId, getter);
  return () => {
    if (getters.get(windowId) === getter) getters.delete(windowId);
  };
}

/** Snapshot for one Paint window, or undefined when it is not open. */
export function getPaintContext(windowId: string): PaintContextSnapshot | undefined {
  return getters.get(windowId)?.();
}
