import { err, type Result } from '../../../shared/errors';

export const AI_TIMEOUT_MS = 30_000;
export const MAX_SIDE = 4096;

/** Scale dimensions down (never up) so the long side is at most `max`. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number; scale: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

export interface AutomateDeps {
  generate(prompt: string, signal: AbortSignal): Promise<Result<{ dataBase64: string }>>;
  /** Replaces the canvas and records history. Must leave the canvas untouched on failure. */
  place(base64: string): Promise<Result<unknown>>;
  timeoutMs?: number;
}

/**
 * Generate an image and place it on the canvas. The canvas changes only when both
 * generation and decoding succeed. `signal` lets the caller cancel.
 */
export async function runAutomate(prompt: string, deps: AutomateDeps, signal?: AbortSignal): Promise<Result<true>> {
  if (prompt.trim() === '') return err('VALIDATION', 'Describe the picture you want first.');
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, deps.timeoutMs ?? AI_TIMEOUT_MS);
  try {
    const gen = await deps.generate(prompt, ctl.signal);
    if (!gen.ok) {
      if (timedOut) return err('AI_TIMEOUT', 'The AI service took too long. Your drawing was not changed.');
      if (signal?.aborted) return err('DECLINED', 'Cancelled. Your drawing was not changed.');
      return err(gen.error.code, `${gen.error.message} Your drawing was not changed.`);
    }
    if (ctl.signal.aborted) {
      return timedOut ? err('AI_TIMEOUT', 'The AI service took too long. Your drawing was not changed.') : err('DECLINED', 'Cancelled. Your drawing was not changed.');
    }
    const placed = await deps.place(gen.value.dataBase64);
    if (!placed.ok) return err(placed.error.code, `${placed.error.message} Your drawing was not changed.`);
    return { ok: true, value: true };
  } catch (e) {
    return err('AI_FAILED', `${e instanceof Error ? e.message : 'Image generation failed.'} Your drawing was not changed.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
