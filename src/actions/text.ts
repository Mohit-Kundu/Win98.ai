import { err, type Result } from '../../shared/errors';
import type { TextTransformRequest } from '../../shared/api-contracts';
import { aiClient } from '../ai/client';
import { markdownToHtml } from './wordpadFiles';
import { sanitizeHtml } from './wordpad/format';

export type TextTransformMode = TextTransformRequest['mode'];

export interface TextTransformInput {
  mode: TextTransformMode;
  text?: string;
  instruction?: string;
}

export interface TextTransformOutput {
  /** Plain text or limited Markdown, exactly as returned by the model. */
  text: string;
  /** The same content converted to sanitized HTML, safe to insert into a document. */
  html: string;
}

/** Ask Gemini to generate or transform text. Never throws. */
export async function textTransform(
  input: TextTransformInput,
  opts?: { signal?: AbortSignal },
): Promise<Result<TextTransformOutput>> {
  try {
    const r = await aiClient.textTransform(input, opts);
    if (!r.ok) return r;
    if (r.value.text.trim() === '') return err('AI_FAILED', 'The AI returned no text.');
    return { ok: true, value: { text: r.value.text, html: sanitizeHtml(markdownToHtml(r.value.text)) } };
  } catch (e) {
    return err('AI_FAILED', 'The AI request failed.', { cause: e instanceof Error ? e.message : String(e) });
  }
}
