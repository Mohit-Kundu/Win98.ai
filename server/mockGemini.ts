import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type {
  ChatRequest,
  ChatResponse,
  Content,
  FileType,
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
import { GeminiError } from './geminiClient.js';
import type { GeminiClient } from './geminiClient.js';

/**
 * Mock_Gemini: a deterministic GeminiClient used only when MOCK_GEMINI=1 (see selectGeminiClient).
 * It replaces only the Gemini call layer. Express routes, validation, limits and error mapping are the real code.
 * Nothing here is imported in production: server/index.ts loads this module with a dynamic import.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SCRIPTS_DIR = path.resolve(here, '../tests/fixtures/scripts');
export const DEFAULT_STUB_PNG = path.resolve(here, '../tests/fixtures/stub.png');

// ---------- Script format ----------

const StepSchema = z.union([
  z.object({ calls: z.array(z.object({ name: z.string().min(1), args: z.record(z.string(), z.unknown()) })).min(1) }),
  z.object({ text: z.string() }),
]);
export const ScriptSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  /** Case-insensitive regular expression tested against the latest user text. Capture groups are `{{match.N}}`. */
  match: z.string().min(1),
  steps: z.array(StepSchema).min(1),
});
export type MockScript = z.infer<typeof ScriptSchema>;

export function loadScripts(dir = DEFAULT_SCRIPTS_DIR): MockScript[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ScriptSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
}

// ---------- Per-request context (fault injection, script override) ----------

export type MockFail = 'timeout' | 'error' | 'nokey';
interface MockRequestContext {
  fail?: MockFail;
  script?: string;
}
const requestContext = new AsyncLocalStorage<MockRequestContext>();

/** Express middleware that exposes `x-mock-fail` and `x-mock-script` headers to the mock client. Mounted only for the mock. */
export const mockRequestMiddleware: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const fail = req.header('x-mock-fail');
  const script = req.header('x-mock-script');
  const ctx: MockRequestContext = {
    ...(fail === 'timeout' || fail === 'error' || fail === 'nokey' ? { fail } : {}),
    ...(script ? { script } : {}),
  };
  requestContext.run(ctx, next);
};

function injectFailure(): void {
  switch (requestContext.getStore()?.fail) {
    case 'timeout':
      throw new GeminiError('AI_TIMEOUT');
    case 'error':
      throw new GeminiError('AI_FAILED');
    case 'nokey':
      throw new GeminiError('AI_UNAVAILABLE');
  }
}

// ---------- Chat script engine ----------

function lastUserText(contents: Content[]): string {
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i];
    if (c?.role !== 'user') continue;
    const text = c.parts
      .map((p) => p.text ?? '')
      .join(' ')
      .trim();
    if (text) return text;
  }
  return '';
}

/** Tool results in order of appearance. Index 0 is `step1`. */
function functionResponses(contents: Content[]): Record<string, unknown>[] {
  return contents.flatMap((c) => (c.role === 'user' ? c.parts.flatMap((p) => (p.functionResponse ? [p.functionResponse.response] : [])) : []));
}

function lookup(root: unknown, dotted: string): unknown {
  let cur = root;
  for (const key of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Looks in `response.value` first (Result<T> shape), then in the response itself. */
function fromStep(response: Record<string, unknown> | undefined, field: string): unknown {
  if (!response) return undefined;
  const inValue = lookup(response['value'], field);
  return inValue !== undefined ? inValue : lookup(response, field);
}

const PLACEHOLDER = /\{\{\s*(step\d+|match)\.([\w.]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*(step\d+|match)\.([\w.]+)\s*\}\}$/;

function resolveRef(ref: string, field: string, responses: Record<string, unknown>[], match: RegExpMatchArray | null): unknown {
  const v = ref === 'match' ? match?.[Number(field)] : fromStep(responses[Number(ref.slice(4)) - 1], field);
  if (v === undefined || v === null) throw new GeminiError('AI_FAILED', `Unresolved mock placeholder {{${ref}.${field}}}`);
  return v;
}

function resolve(value: unknown, responses: Record<string, unknown>[], match: RegExpMatchArray | null): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE.exec(value);
    if (whole) return resolveRef(whole[1] as string, whole[2] as string, responses, match);
    return value.replace(PLACEHOLDER, (_m, ref: string, field: string) => String(resolveRef(ref, field, responses, match)));
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, responses, match));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, responses, match)]));
  }
  return value;
}

function chatFromScripts(scripts: MockScript[], req: ChatRequest): ChatResponse {
  const userText = lastUserText(req.contents);
  const forced = requestContext.getStore()?.script;
  let script: MockScript | undefined;
  let match: RegExpMatchArray | null = null;
  if (forced) {
    script = scripts.find((s) => s.name === forced);
    if (script) match = userText.match(new RegExp(script.match, 'i'));
  } else {
    for (const s of scripts) {
      const m = userText.match(new RegExp(s.match, 'i'));
      if (m) {
        script = s;
        match = m;
        break;
      }
    }
  }
  const textOnly = (text: string): ChatResponse => ({
    modelContent: { role: 'model', parts: [{ text }] },
    text,
    functionCalls: [],
  });
  if (!script) return textOnly('Mock_Gemini has no script for this request.');

  const responses = functionResponses(req.contents);
  const step = script.steps[responses.length];
  if (!step) return textOnly('Done.');
  if ('text' in step) return textOnly(resolve(step.text, responses, match) as string);

  const calls = step.calls.map((c) => ({ name: c.name, args: resolve(c.args, responses, match) as Record<string, unknown> }));
  return {
    modelContent: { role: 'model', parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) },
    functionCalls: calls,
  };
}

// ---------- Deterministic single-shot endpoints ----------

function titleFromName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Untitled';
}

function mockMetadata(req: MetadataRequest): MetadataResponse {
  const hay = `${req.name} ${req.text ?? ''}`.toLowerCase();
  const title = titleFromName(req.name);
  if (/machine[\s-]*learning/.test(hay)) {
    return {
      title,
      description: `A document about machine learning (${req.name}).`,
      category: 'Technology/AI',
      tags: ['machine learning', 'ai'],
    };
  }
  const snippet = (req.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return {
    title,
    description: snippet ? `${title}: ${snippet}` : `A ${req.kind} file named ${req.name}.`,
    category: req.kind === 'image' ? 'Pictures' : 'General',
    tags: [req.kind],
  };
}

const DAY = 86_400_000;
const FILLER = /\b(?:the|a|an|document|documents|file|files|about|on|regarding|find|show|me|my|from|of|that|is|are|i|made|created|modified|edited|saved)\b/gi;

function mockSearchQuery(req: SearchQueryRequest): SearchQueryResponse {
  const now = Date.parse(req.now);
  const q = req.query.toLowerCase();
  let rest = q;
  const out: SearchQueryResponse = { terms: '' };

  const typeWords: Array<[RegExp, FileType]> = [
    [/\bpdfs?\b/, 'pdf'],
    [/\b(?:images?|pictures?|photos?|pngs?)\b/, 'png'],
    [/\bjpe?gs?\b/, 'jpg'],
    [/\bmarkdown\b/, 'md'],
  ];
  for (const [re, t] of typeWords) {
    if (re.test(rest)) {
      out.type = t;
      rest = rest.replace(re, ' ');
      break;
    }
  }

  const ranges: Array<[RegExp, [number, number]]> = [
    [/\blast week\b/, [now - 7 * DAY, now]],
    [/\blast month\b/, [now - 30 * DAY, now]],
    [/\byesterday\b/, [now - 2 * DAY, now - DAY]],
    [/\btoday\b/, [now - DAY, now]],
  ];
  for (const [re, range] of ranges) {
    if (re.test(rest)) {
      if (/\b(?:modified|edited|updated|changed)\b/.test(q)) out.modifiedRange = range;
      else out.createdRange = range;
      rest = rest.replace(re, ' ');
      break;
    }
  }

  out.terms = rest.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

function leaf(p: string): string {
  return (p.split(/[\\/]/).pop() ?? '').toLowerCase();
}

function mockOrganize(req: OrganizeRequest): OrganizeResponse {
  const moves = req.files.map((f) => {
    const t = f.type.toLowerCase();
    const wanted = (f.category ?? '').split('/').pop()?.toLowerCase();
    const existing = wanted ? req.folders.find((p) => leaf(p) === wanted) : undefined;
    const fallback = ['png', 'jpg', 'jpeg'].includes(t) ? 'C:\\My Pictures' : 'C:\\My Documents';
    const destination = existing ?? (f.category ? `C:\\My Documents\\${f.category.split('/').pop()}` : fallback);
    return { fileId: f.id, destination };
  });
  return { moves };
}

const TRANSFORM_PREFIX = {
  generate: '[generated]',
  rewrite: '[rewritten]',
  summarize: '[summary]',
  proofread: '[proofread]',
  expand: '[expanded]',
} as const;

function mockTextTransform(req: TextTransformRequest): TextTransformResponse {
  const body = req.mode === 'generate' ? (req.instruction?.trim() || req.text?.trim() || '') : (req.text ?? '');
  return { text: `${TRANSFORM_PREFIX[req.mode]} ${body}` };
}

// ---------- Client ----------

export interface MockGeminiOptions {
  scripts?: MockScript[];
  stubPngPath?: string;
}

export function createMockGeminiClient(opts: MockGeminiOptions = {}): GeminiClient {
  const scripts = opts.scripts ?? loadScripts();
  const stubPng = opts.stubPngPath ?? DEFAULT_STUB_PNG;
  return {
    chat: async (req) => (injectFailure(), chatFromScripts(scripts, req)),
    generateImage: async (): Promise<GenerateImageResponse> => {
      injectFailure();
      return { mimeType: 'image/png', dataBase64: fs.readFileSync(stubPng).toString('base64') };
    },
    metadata: async (req) => (injectFailure(), mockMetadata(req)),
    searchQuery: async (req) => (injectFailure(), mockSearchQuery(req)),
    organize: async (req) => (injectFailure(), mockOrganize(req)),
    textTransform: async (req) => (injectFailure(), mockTextTransform(req)),
  };
}
