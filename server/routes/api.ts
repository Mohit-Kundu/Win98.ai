import { Router } from 'express';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  ChatRequestSchema,
  ChatResponseSchema,
  GenerateImageRequestSchema,
  GenerateImageResponseSchema,
  MetadataRequestSchema,
  MetadataResponseSchema,
  OrganizeRequestSchema,
  OrganizeResponseSchema,
  SearchQueryRequestSchema,
  SearchQueryResponseSchema,
  TextTransformRequestSchema,
  TextTransformResponseSchema,
} from '../../shared/api-contracts.js';
import type { ApiErrorCode, ApiErrorResponse, HealthResponse } from '../../shared/api-contracts.js';
import { GeminiError } from '../geminiClient.js';
import type { GeminiClient } from '../geminiClient.js';

export const GEMINI_TIMEOUT_MS = 30_000;

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION: 400,
  TOO_LARGE: 413,
  AI_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  AI_FAILED: 502,
};
const MESSAGE: Record<ApiErrorCode, string> = {
  VALIDATION: 'Invalid request.',
  TOO_LARGE: 'Request is too large.',
  AI_UNAVAILABLE: 'AI is not available.',
  AI_TIMEOUT: 'The AI request timed out.',
  AI_FAILED: 'The AI request failed.',
};

export function sendError(res: Response, code: ApiErrorCode, issues?: unknown[]): void {
  const body: ApiErrorResponse = { error: { code, message: MESSAGE[code], ...(issues ? { issues } : {}) } };
  res.status(STATUS[code]).json(body);
}

export interface ApiOptions {
  /** Null means no key / no provider: AI endpoints answer 503 and health reports ai: false. */
  gemini: GeminiClient | null;
  timeoutMs?: number;
  /** Server-side logger for raw failures. Raw errors are never sent to the client. */
  log?: (message: string, err: unknown) => void;
}

export function createApiRouter(opts: ApiOptions): Router {
  const router = Router();
  const timeoutMs = opts.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const log = opts.log ?? ((m, e) => console.error(m, e instanceof Error ? e.name : 'error'));

  router.get('/health', (_req, res) => {
    const body: HealthResponse = { ok: true, ai: opts.gemini !== null };
    res.json(body);
  });

  function post<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
    path: string,
    reqSchema: I,
    resSchema: O,
    call: (client: GeminiClient, input: z.infer<I>, signal: AbortSignal) => Promise<unknown>,
  ): void {
    router.post(path, async (req: Request, res: Response) => {
      const parsed = reqSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 'VALIDATION', parsed.error.issues);
      if (!opts.gemini) return sendError(res, 'AI_UNAVAILABLE');
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const out = await call(opts.gemini, parsed.data, signal);
        const checked = resSchema.safeParse(out);
        if (!checked.success) {
          log(`Invalid AI output for ${path}`, checked.error);
          return sendError(res, 'AI_FAILED');
        }
        res.json(checked.data);
      } catch (e) {
        if (e instanceof GeminiError) {
          if (e.code === 'AI_TIMEOUT' || e.code === 'AI_UNAVAILABLE') return sendError(res, e.code);
        } else {
          log(`AI call failed for ${path}`, e);
        }
        sendError(res, signal.aborted ? 'AI_TIMEOUT' : 'AI_FAILED');
      }
    });
  }

  post('/chat', ChatRequestSchema, ChatResponseSchema, (c, i, s) => c.chat(i, s));
  post('/generate-image', GenerateImageRequestSchema, GenerateImageResponseSchema, (c, i, s) => c.generateImage(i, s));
  post('/metadata', MetadataRequestSchema, MetadataResponseSchema, (c, i, s) => c.metadata(i, s));
  post('/search-query', SearchQueryRequestSchema, SearchQueryResponseSchema, (c, i, s) => c.searchQuery(i, s));
  post('/organize', OrganizeRequestSchema, OrganizeResponseSchema, (c, i, s) => c.organize(i, s));
  post('/text-transform', TextTransformRequestSchema, TextTransformResponseSchema, (c, i, s) => c.textTransform(i, s));

  return router;
}
