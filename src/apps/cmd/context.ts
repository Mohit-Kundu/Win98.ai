/** CMD Context_Provider hook point. The AI context registry (task 9.x) reads snapshots from here. */
export interface CmdContextSnapshot {
  app: 'cmd';
  cwd: string;
  lastOutput: string[];
}

const states = new Map<string, CmdContextSnapshot>();
const MAX_OUTPUT_LINES = 50;

export function setCmdState(windowId: string, cwd: string, lastOutput: string[]): void {
  states.set(windowId, { app: 'cmd', cwd, lastOutput: lastOutput.slice(-MAX_OUTPUT_LINES) });
}

export function clearCmdState(windowId: string): void {
  states.delete(windowId);
}

/** Snapshot of a CMD window, or undefined when the window is not open. */
export function getCmdSnapshot(windowId: string): CmdContextSnapshot | undefined {
  return states.get(windowId);
}

/**
 * Hook point for natural-language input (`ai ...` and `nl on`). Task 9.10 registers the Orchestrator here.
 * Returns the lines to print.
 */
export interface NaturalLanguageContext {
  windowId: string;
  cwd: string;
  /** Prints a progress line immediately (before the handler returns). */
  print?: (line: string) => void;
  /** Aborted when the user presses Ctrl+C. */
  signal?: AbortSignal;
}
export type NaturalLanguageHandler = (instruction: string, ctx: NaturalLanguageContext) => Promise<string[]>;

let nlHandler: NaturalLanguageHandler | undefined;

export function setNaturalLanguageHandler(handler: NaturalLanguageHandler | undefined): void {
  nlHandler = handler;
}

export function getNaturalLanguageHandler(): NaturalLanguageHandler | undefined {
  return nlHandler;
}
