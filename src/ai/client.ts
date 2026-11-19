import type { z } from 'zod';
import {
  ApiErrorResponseSchema,
  ChatResponseSchema,
  GenerateImageResponseSchema,
  HealthResponseSchema,
  MetadataResponseSchema,
  OrganizeResponseSchema,
  SearchQueryResponseSchema,
  TextTransformResponseSchema,
  type ChatRequest,
  type ChatResponse,
  type GenerateImageRequest,
  type GenerateImageResponse,
  type HealthResponse,
  type MetadataRequest,
  type MetadataResponse,
  type OrganizeRequest,
  type OrganizeResponse,
  type SearchQueryRequest,
  type SearchQueryResponse,
  type TextTransformRequest,
  type TextTransformResponse,
} from '../../shared/api-contracts';
import { err, ok, type ErrorCode, type Result } from '../../shared/errors';

export interface CallOptions {
  signal?: AbortSignal;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION',
  413: 'TOO_LARGE',
  502: 'AI_FAILED',
  503: 'AI_UNAVAILABLE',
  504: 'AI_TIMEOUT',
};

function statusToCode(status: number): ErrorCode {
  return STATUS_CODES[status] ?? 'AI_FAILED';
}

async function request<S extends z.ZodTypeAny>(
  method: 'GET' | 'POST',
  path: string,
  schema: S,
  body: unknown,
  opts?: CallOptions,
): Promise<Result<z.infer<S>>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts?.signal,
    });
  } catch (e) {
    if (opts?.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) {
      return err('AI_FAILED', 'The request was cancelled.', { aborted: true });
    }
    return err('AI_UNAVAILABLE', 'Could not reach the AI service.');
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const env = ApiErrorResponseSchema.safeParse(json);
    if (env.success) {
      const { code, message, issues } = env.data.error;
      // Prefer the HTTP status mapping; fall back to the envelope code for unmapped statuses.
      const mapped = STATUS_CODES[res.status] ?? code;
      return err(mapped, message, issues);
    }
    return err(statusToCode(res.status), `Request failed with status ${res.status}.`);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return err('AI_FAILED', 'The AI service returned an unexpected response.', parsed.error.issues);
  }
  return ok(parsed.data);
}

export const aiClient = {
  health: (opts?: CallOptions): Promise<Result<HealthResponse>> =>
    request('GET', '/api/health', HealthResponseSchema, undefined, opts),

  chat: (req: ChatRequest, opts?: CallOptions): Promise<Result<ChatResponse>> =>
    request('POST', '/api/chat', ChatResponseSchema, req, opts),

  generateImage: (req: GenerateImageRequest, opts?: CallOptions): Promise<Result<GenerateImageResponse>> =>
    request('POST', '/api/generate-image', GenerateImageResponseSchema, req, opts),

  metadata: (req: MetadataRequest, opts?: CallOptions): Promise<Result<MetadataResponse>> =>
    request('POST', '/api/metadata', MetadataResponseSchema, req, opts),

  searchQuery: (req: SearchQueryRequest, opts?: CallOptions): Promise<Result<SearchQueryResponse>> =>
    request('POST', '/api/search-query', SearchQueryResponseSchema, req, opts),

  organize: (req: OrganizeRequest, opts?: CallOptions): Promise<Result<OrganizeResponse>> =>
    request('POST', '/api/organize', OrganizeResponseSchema, req, opts),

  textTransform: (req: TextTransformRequest, opts?: CallOptions): Promise<Result<TextTransformResponse>> =>
    request('POST', '/api/text-transform', TextTransformResponseSchema, req, opts),
};

/** True only when the server is reachable and reports a configured Gemini key. Never throws. */
export async function isAiAvailable(opts?: CallOptions): Promise<boolean> {
  const r = await aiClient.health(opts);
  return r.ok && r.value.ai;
}
