import { create } from 'zustand';
import type { PriorTurn, StoppedBy } from '../../ai/types';

export type StepLineStatus = 'running' | 'ok' | 'failed' | 'declined';

export interface StepLine {
  id: number;
  tool: string;
  status: StepLineStatus;
  /** Short detail from the real tool result (path or error). */
  detail?: string;
}

export type ChatMessage =
  | { id: number; role: 'user'; text: string }
  | {
      id: number;
      role: 'assistant';
      /** The model's own words. Display only, never evidence of success. */
      text: string;
      /** Authoritative summary built from the executed steps. */
      report: string;
      steps: StepLine[];
      stoppedBy: StoppedBy;
    };

type NewMessage = ChatMessage extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never;

export type ClippyPhase = 'idle' | 'thinking' | 'speaking';

interface ChatStore {
  open: boolean;
  phase: ClippyPhase;
  running: boolean;
  messages: ChatMessage[];
  liveSteps: StepLine[];
  setOpen(open: boolean): void;
  setPhase(phase: ClippyPhase): void;
  setRunning(running: boolean): void;
  addMessage(message: NewMessage): void;
  setLiveSteps(updater: (steps: StepLine[]) => StepLine[]): void;
  reset(): void;
}

let nextId = 1;
export const nextChatId = () => nextId++;

const initial = { open: false, phase: 'idle' as ClippyPhase, running: false, messages: [] as ChatMessage[], liveSteps: [] as StepLine[] };

/** Session-only chat state. Lives in memory, so a page reload clears it (no long-term memory). */
export const useChatStore = create<ChatStore>((set) => ({
  ...initial,
  setOpen: (open) => set({ open }),
  setPhase: (phase) => set({ phase }),
  setRunning: (running) => set({ running }),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, { ...m, id: nextChatId() } as ChatMessage] })),
  setLiveSteps: (updater) => set((s) => ({ liveSteps: updater(s.liveSteps) })),
  reset: () => set({ ...initial }),
}));

/** Last turns as plain text for the Orchestrator (it keeps at most the last 6). */
export function priorTurns(messages: ChatMessage[]): PriorTurn[] {
  const turns: PriorTurn[] = [];
  for (const m of messages) {
    if (m.role === 'user') turns.push({ role: 'user', text: m.text });
    else {
      // The report is authoritative, so the model sees what really happened.
      const text = [m.text, m.report].filter((t) => t.trim()).join('\n');
      if (text) turns.push({ role: 'assistant', text });
    }
  }
  return turns;
}
