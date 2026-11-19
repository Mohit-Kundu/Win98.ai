import { create } from 'zustand';
import { ConfirmDialog } from '../ui/dialogs';
import type { ConfirmRequest } from './types';

interface Pending {
  id: number;
  request: ConfirmRequest;
  resolve: (answer: boolean) => void;
}

interface ConfirmStore {
  queue: Pending[];
  answer(id: number, value: boolean): void;
}

let nextId = 1;

export const useAiConfirmStore = create<ConfirmStore>((set, get) => ({
  queue: [],
  answer(id, value) {
    const item = get().queue.find((p) => p.id === id);
    if (!item) return;
    set((s) => ({ queue: s.queue.filter((p) => p.id !== id) }));
    item.resolve(value);
  },
}));

/** Shows a confirmation dialog (through <AiConfirmHost/>) and resolves true only when the user accepts. */
export function requestAiConfirmation(request: ConfirmRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const id = nextId++;
    useAiConfirmStore.setState((s) => ({ queue: [...s.queue, { id, request, resolve }] }));
  });
}

/** Mounted once in the desktop root. Shows queued AI confirmations one at a time. */
export function AiConfirmHost() {
  const first = useAiConfirmStore((s) => s.queue[0]);
  const answer = useAiConfirmStore((s) => s.answer);
  if (!first) return null;
  return (
    <ConfirmDialog
      key={first.id}
      title="Confirm assistant action"
      message={first.request.message}
      onConfirm={() => answer(first.id, true)}
      onCancel={() => answer(first.id, false)}
    />
  );
}
