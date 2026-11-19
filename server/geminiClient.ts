import type {
  ChatRequest,
  ChatResponse,
  GenerateImageRequest,
  GenerateImageResponse,
  MetadataRequest,
  MetadataResponse,
  OrganizeRequest,
  OrganizeResponse,
  SearchQueryRequest,
  SearchQueryResponse,
  TextTransformRequest,
  TextTransformResponse,
} from '../shared/api-contracts.js';

/** Error a GeminiClient throws. The route layer maps `code` to an HTTP status. Never carries SDK text. */
export class GeminiError extends Error {
  constructor(
    public readonly code: 'AI_TIMEOUT' | 'AI_FAILED' | 'AI_UNAVAILABLE',
    message = 'AI request failed.',
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * The only seam between the Express routes and a model provider. The real implementation
 * is `createGeminiClient` (server/gemini.ts); Mock_Gemini (task 7.3) implements the same interface.
 * Every method must honor `signal` and may return unvalidated model output: routes re-validate with Zod.
 */
export interface GeminiClient {
  chat(req: ChatRequest, signal: AbortSignal): Promise<ChatResponse>;
  generateImage(req: GenerateImageRequest, signal: AbortSignal): Promise<GenerateImageResponse>;
  metadata(req: MetadataRequest, signal: AbortSignal): Promise<MetadataResponse>;
  searchQuery(req: SearchQueryRequest, signal: AbortSignal): Promise<SearchQueryResponse>;
  organize(req: OrganizeRequest, signal: AbortSignal): Promise<OrganizeResponse>;
  textTransform(req: TextTransformRequest, signal: AbortSignal): Promise<TextTransformResponse>;
}
