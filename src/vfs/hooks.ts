import { useEffect, useState } from 'react';
import type { NodeRecord } from './db';
import { vfs, type VfsService } from './service';

/** Re-run `load` on mount, when `key` changes, and after any VFS event. */
function useLive<T>(load: () => Promise<T>, key: string | null, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const refresh = () => {
      load()
        .then((v) => {
          if (!cancelled) setValue(v);
        })
        .catch((e: unknown) => console.error('VFS hook load failed', e));
    };
    refresh();
    const unsub = vfs.subscribe(refresh);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [key]);
  return value;
}

/** Children of a folder, kept current as the VFS changes. */
export function useFolder(folderId: string | null, service: VfsService = vfs): NodeRecord[] {
  return useLive(() => service.list(folderId as string), folderId, []);
}

/** A single node (undefined while loading or if missing), kept current as the VFS changes. */
export function useNode(nodeId: string | null, service: VfsService = vfs): NodeRecord | undefined {
  return useLive(() => service.get(nodeId as string), nodeId, undefined);
}
