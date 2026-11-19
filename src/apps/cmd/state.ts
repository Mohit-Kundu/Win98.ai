/** Prompt text for a working directory, e.g. `C:\>` or `C:\My Documents>`. */
export function formatPrompt(cwd: string): string {
  return `${cwd}>`;
}

export const HISTORY_LIMIT = 500;

export interface HistoryState {
  entries: string[];
  /** Index into entries; equals entries.length when not browsing history. */
  cursor: number;
}

export type HistoryAction = { type: 'push'; line: string } | { type: 'up' } | { type: 'down' };

export const initialHistory: HistoryState = { entries: [], cursor: 0 };

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'push': {
      const line = action.line.trim();
      if (line === '') return { entries: state.entries, cursor: state.entries.length };
      let entries = state.entries;
      if (entries[entries.length - 1] !== line) {
        entries = [...entries, line].slice(-HISTORY_LIMIT);
      }
      return { entries, cursor: entries.length };
    }
    case 'up':
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case 'down':
      return { ...state, cursor: Math.min(state.entries.length, state.cursor + 1) };
  }
}

/** Text to show in the input line for the current cursor ('' when past the newest entry). */
export function historyText(state: HistoryState): string {
  return state.entries[state.cursor] ?? '';
}

export interface ModeState {
  nl: boolean;
}

export type ModeAction = { type: 'nl on' } | { type: 'nl off' };

export const initialMode: ModeState = { nl: false };

export function modeReducer(state: ModeState, action: ModeAction): ModeState {
  const nl = action.type === 'nl on';
  return state.nl === nl ? state : { nl };
}
