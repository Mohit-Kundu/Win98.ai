import type { z } from 'zod';
import { ContentSchema, MetadataResponseSchema, OrganizeResponseSchema, SearchQueryResponseSchema, TextTransformResponseSchema } from '../shared/api-contracts.js';
import type { ChatRequest, ChatResponse, Content } from '../shared/api-contracts.js';
import { GeminiError } from './geminiClient.js';
import type { GeminiClient } from './geminiClient.js';
import {
  METADATA_SCHEMA,
  ORGANIZE_SCHEMA,
  SEARCH_SCHEMA,
  SYSTEM_INSTRUCTION,
  metadataPrompt,
  organizePrompt,
  parseJson,
  searchPrompt,
  transformPrompt,
} from './gemini.js';
import { createLogger } from './logger.js';
import { errorSummary } from '../shared/log.js';
const log = createLogger('openrouter');

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_OPENROUTER_TEXT_MODEL = 'deepseek/deepseek-v4-flash';
export const DEFAULT_OPENROUTER_IMAGE_MODEL = 'black-forest-labs/flux.2-klein-4b';

/** images uses POST /images (image-only models like FLUX). chat uses chat completions with image modalities (e.g. Gemini image models). */
export type ImageApi = 'images' | 'chat';

export interface OpenRouterEnv {
  OPENROUTER_API_KEY?: string | undefined;
  OPENROUTER_TEXT_MODEL?: string | undefined;
  OPENROUTER_IMAGE_MODEL?: string | undefined;
  OPENROUTER_BASE_URL?: string | undefined;
  OPENROUTER_IMAGE_API?: string | undefined;
}

/** Returns a real client, or null when no key is configured. The key is read only from the environment. */
export function createOpenRouterClientFromEnv(env: OpenRouterEnv = process.env): GeminiClient | null {
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  return createOpenRouterClient({
    apiKey: key,
    textModel: env.OPENROUTER_TEXT_MODEL?.trim() || DEFAULT_OPENROUTER_TEXT_MODEL,
    imageModel: env.OPENROUTER_IMAGE_MODEL?.trim() || DEFAULT_OPENROUTER_IMAGE_MODEL,
    baseUrl: env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL,
    imageApi: env.OPENROUTER_IMAGE_API?.trim().toLowerCase() === 'chat' ? 'chat' : 'images',
  });
}

interface Options {
  apiKey: string;
  textModel: string;
  imageModel: string;
  baseUrl: string;
  imageApi: ImageApi;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

// ---------- OpenAI-compatible wire types (only the fields used here) ----------
type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface CompletionResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
      images?: { image_url?: { url?: string } }[];
    };
  }[];
}

/**
 * Converts the Gemini-shaped conversation the client sends into OpenAI chat messages.
 * Gemini function calls may lack ids, so ids are synthesized per model turn and matched to the
 * following functionResponse parts by name, in order.
 */
export function toOpenAiMessages(contents: Content[], system: string): Message[] {
  const messages: Message[] = [{ role: 'system', content: system }];
  let pending: { id: string; name: string }[] = [];
  let seq = 0;
  for (const c of contents) {
    if (c.role === 'model') {
      const text = c.parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text as string).join('');
      const calls: ToolCall[] = [];
      pending = [];
      for (const p of c.parts) {
        if (!p.functionCall) continue;
        const id = p.functionCall.id || `call_${seq++}`;
        pending.push({ id, name: p.functionCall.name });
        calls.push({ id, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) } });
      }
      const m: Message = { role: 'assistant', content: text || null };
      if (calls.length) m.tool_calls = calls;
      messages.push(m);
      continue;
    }
    const userParts: ContentPart[] = [];
    for (const p of c.parts) {
      if (p.functionResponse) {
        const i = pending.findIndex((x) => x.name === p.functionResponse!.name);
        const id = p.functionResponse.id || (i >= 0 ? pending[i]!.id : `call_${seq++}`);
        if (i >= 0) pending.splice(i, 1);
        messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(p.functionResponse.response) });
      } else if (p.inlineData) {
        userParts.push({ type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
      } else if (typeof p.text === 'string') {
        userParts.push({ type: 'text', text: p.text });
      }
    }
    if (userParts.length) messages.push({ role: 'user', content: userParts });
  }
  return messages;
}

/** Some models wrap JSON in a Markdown code fence even when asked not to. */
function stripFence(raw: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(raw);
  return m ? m[1]! : raw;
}

export function createOpenRouterClient(opts: Options): GeminiClient {
  const doFetch = opts.fetch ?? fetch;

  async function post(path: string, model: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    try {
      const res = await doFetch(`${opts.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Win98.ai' },
        body: JSON.stringify({ model, ...body }),
        signal,
      });
      if (!res.ok) {
        // Status only: response bodies can echo request content.
        log.error(`${path} failed`, { model, ms: ms(), status: res.status });
        throw new GeminiError(res.status === 401 || res.status === 403 || res.status === 402 ? 'AI_UNAVAILABLE' : 'AI_FAILED');
      }
      const data: unknown = await res.json();
      if (!data || typeof data !== 'object' || 'error' in data) {
        log.error(`${path} returned an error body`, { model, ms: ms() });
        throw new GeminiError('AI_FAILED', 'The AI returned an empty response.');
      }
      log.info(`${path} ok`, { model, ms: ms() });
      return data;
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      const name = e instanceof Error ? e.name : '';
      if (name === 'TimeoutError' || name === 'AbortError' || signal.aborted) {
        log.error(`${path} aborted`, { model, ms: ms() });
        throw new GeminiError('AI_TIMEOUT', 'The AI request timed out.');
      }
      log.error(`${path} failed`, { model, ms: ms(), error: errorSummary(e) });
      throw new GeminiError('AI_FAILED', 'The AI request failed.');
    }
  }

  async function complete(model: string, body: Record<string, unknown>, signal: AbortSignal): Promise<CompletionResponse> {
    const data = (await post('/chat/completions', model, body, signal)) as CompletionResponse;
    if (!data.choices?.length) throw new GeminiError('AI_FAILED', 'The AI returned an empty response.');
    return data;
  }

  async function json<T extends z.ZodTypeAny>(
    schema: T,
    jsonSchema: unknown,
    name: string,
    prompt: string,
    extra: ContentPart[],
    signal: AbortSignal,
  ): Promise<z.infer<T>> {
    const res = await complete(
      opts.textModel,
      {
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: [{ type: 'text', text: prompt }, ...extra] },
        ],
        response_format: { type: 'json_schema', json_schema: { name, strict: false, schema: jsonSchema } },
      },
      signal,
    );
    return parseJson(schema, stripFence(res.choices?.[0]?.message?.content ?? ''));
  }

  return {
    async chat(req: ChatRequest, signal) {
      const system = req.systemContext ? `${SYSTEM_INSTRUCTION}\n\n${req.systemContext}` : SYSTEM_INSTRUCTION;
      const res = await complete(
        opts.textModel,
        {
          messages: toOpenAiMessages(req.contents, system),
          ...(req.tools.length
            ? {
                tools: req.tools.map((t) => ({
                  type: 'function',
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parametersJsonSchema ?? { type: 'object', properties: {} },
                  },
                })),
                tool_choice: 'auto',
              }
            : {}),
        },
        signal,
      );
      const msg = res.choices?.[0]?.message;
      const text = msg?.content ?? '';
      const parts: Content['parts'] = [];
      if (text) parts.push({ text });
      const functionCalls: ChatResponse['functionCalls'] = [];
      for (const call of msg?.tool_calls ?? []) {
        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(call.function.arguments || '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
        } catch {
          throw new GeminiError('AI_FAILED', 'The AI returned an unreadable response.');
        }
        parts.push({ functionCall: { id: call.id, name: call.function.name, args } });
        functionCalls.push({ name: call.function.name, args });
      }
      if (!parts.length) throw new GeminiError('AI_FAILED', 'The AI returned an empty response.');
      const modelContent = ContentSchema.safeParse({ role: 'model', parts });
      if (!modelContent.success) throw new GeminiError('AI_FAILED', 'The AI returned an unexpected response.');
      const out: ChatResponse = { modelContent: modelContent.data, functionCalls };
      if (text) out.text = text;
      return out;
    },

    async generateImage(req, signal) {
      if (opts.imageApi === 'images') {
        // Dedicated image endpoint, used by image-only models such as FLUX.
        const res = (await post(
          '/images',
          opts.imageModel,
          { prompt: req.prompt, response_format: 'b64_json', output_format: 'png', ...(req.aspect ? { aspect_ratio: req.aspect } : {}) },
          signal,
        )) as { data?: { b64_json?: string; media_type?: string }[] };
        const img = res.data?.[0];
        if (!img?.b64_json) throw new GeminiError('AI_FAILED', 'The AI did not return an image.');
        return { mimeType: img.media_type || 'image/png', dataBase64: img.b64_json };
      }
      const res = await complete(
        opts.imageModel,
        {
          messages: [{ role: 'user', content: req.prompt }],
          modalities: ['image', 'text'],
          ...(req.aspect ? { image_config: { aspect_ratio: req.aspect } } : {}),
        },
        signal,
      );
      const url = res.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      const m = url ? /^data:([^;,]+);base64,(.+)$/s.exec(url) : null;
      if (!m) throw new GeminiError('AI_FAILED', 'The AI did not return an image.');
      return { mimeType: m[1]!, dataBase64: m[2]! };
    },

    metadata(req, signal) {
      const extra: ContentPart[] = [];
      if (req.text) extra.push({ type: 'text', text: `File content:\n${req.text}` });
      if (req.imageBase64) extra.push({ type: 'image_url', image_url: { url: `data:${req.mime};base64,${req.imageBase64}` } });
      return json(MetadataResponseSchema, METADATA_SCHEMA, 'metadata', metadataPrompt(req), extra, signal);
    },

    searchQuery(req, signal) {
      return json(SearchQueryResponseSchema, SEARCH_SCHEMA, 'search_query', searchPrompt(req), [], signal);
    },

    organize(req, signal) {
      return json(OrganizeResponseSchema, ORGANIZE_SCHEMA, 'organize', organizePrompt(req), [], signal);
    },

    async textTransform(req, signal) {
      const res = await complete(
        opts.textModel,
        {
          messages: [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            { role: 'user', content: transformPrompt(req) },
          ],
        },
        signal,
      );
      const text = res.choices?.[0]?.message?.content ?? '';
      if (!text) throw new GeminiError('AI_FAILED', 'The AI returned an empty response.');
      return TextTransformResponseSchema.parse({ text });
    },
  };
}
