import type { ErrorCode, Result } from '../../shared/errors';

/**
 * Minimal context for one Orchestrator run. Task 7.10 (Context_Providers) builds this from the focused
 * window's provider only. `snapshot` must already be truncated and JSON-safe.
 */
export interface AiContextSnapshot {
  activeApp?: string;
  snapshot?: unknown;
  cwdHint?: string;
}

/** A plain-text chat turn replayed as history (design: at most the last 6 turns). */
export interface PriorTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ConfirmRequest {
  tool: string;
  args: unknown;
  /** Human-readable question for the dialog. */
  message: string;
}

export type StepStatus = 'ok' | 'error' | 'declined' | 'invalid' | 'unknown_tool';

export interface OrchestratorStep {
  tool: string;
  args: unknown;
  result: Result<unknown>;
  status: StepStatus;
}

export type RunEvent =
  | { type: 'thinking' }
  | { type: 'tool_start'; tool: string; args: unknown }
  | { type: 'tool_end'; step: OrchestratorStep };

export type StoppedBy = 'model_done' | 'limit' | 'error' | 'aborted';

export interface OrchestratorRun {
  userText: string;
  context?: AiContextSnapshot;
  history?: PriorTurn[];
  confirm: (req: ConfirmRequest) => Promise<boolean>;
  onEvent?: (e: RunEvent) => void;
  signal?: AbortSignal;
}

export interface OrchestratorResult {
  /** The model's own final text. Never used as evidence that a step succeeded. */
  finalText: string;
  /** Authoritative summary built from `steps`. Show this next to (or instead of) `finalText`. */
  report: string;
  steps: OrchestratorStep[];
  stoppedBy: StoppedBy;
  /** Set when stoppedBy is 'error'. */
  error?: { code: ErrorCode; message: string };
}
