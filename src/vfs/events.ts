export type VfsEventType = 'created' | 'updated' | 'renamed' | 'moved' | 'deleted' | 'metaChanged';

export interface VfsEvent {
  type: VfsEventType;
  nodeId: string;
  parentId: string | null;
}

export type VfsListener = (e: VfsEvent) => void;

/** Post-commit event emitter. Call `emit` only after the transaction has committed. */
export class VfsEmitter {
  private listeners = new Set<VfsListener>();

  subscribe(fn: VfsListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(e: VfsEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(e);
      } catch (error) {
        console.error('VFS listener failed', error);
      }
    }
  }
}

export const vfsEvents = new VfsEmitter();
