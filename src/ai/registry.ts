import { z } from 'zod';
import type { Result } from '../../shared/errors';
import type { CoreActions, DocumentActions, ExecuteCommand, ImageActions, OrganizeActions, SearchActions } from '../actions';

/** Matches the name regex in shared/api-contracts.ts (FunctionDeclarationSchema). */
export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

/** Every action a tool handler may call. Tools never touch the VFS directly. */
export type ToolActions = CoreActions & DocumentActions & ImageActions & SearchActions & OrganizeActions & { executeCommand: ExecuteCommand };

export interface ToolContext {
  actions: ToolActions;
  signal: AbortSignal;
}

export interface ToolDef<I extends z.ZodType = z.ZodType, O = unknown> {
  name: string;
  description: string;
  input: I;
  /** Static flag, or a predicate computed from the validated arguments. */
  destructive?: boolean | ((args: z.output<I>) => boolean);
  /** Human-readable text for the confirmation dialog. */
  describeForConfirm?: (args: z.output<I>) => string;
  /** Tool is exposed only while one of these apps is active. Omitted means always exposed. */
  appScope?: string[];
  handler: (args: z.output<I>, ctx: ToolContext) => Promise<Result<O>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDef = ToolDef<any, any>;

export interface FunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

/** Identity helper that keeps argument types inferred from the Zod schema. */
export function defineTool<I extends z.ZodType, O>(def: ToolDef<I, O>): ToolDef<I, O> {
  return def;
}

/** True when the call needs user confirmation. */
export function isDestructive(tool: AnyToolDef, args: unknown): boolean {
  const d = tool.destructive;
  return typeof d === 'function' ? d(args) : d === true;
}

// Keywords Gemini's parametersJsonSchema rejects or does not need.
const STRIPPED_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'additionalProperties',
  'patternProperties',
  'propertyNames',
  'unevaluatedProperties',
  'not',
  'const',
]);
const ALLOWED_FORMATS = new Set(['enum', 'date-time']);

/** Deep-copy a JSON schema without keywords Gemini rejects. */
export function sanitizeForGemini<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((s) => sanitizeForGemini(s)) as T;
  if (schema === null || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (STRIPPED_KEYS.has(key)) continue;
    if (key === 'format' && typeof value === 'string' && !ALLOWED_FORMATS.has(value)) continue;
    // `properties` maps user-chosen names to schemas; sanitize the values but keep every name.
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeForGemini(v)]),
      );
      continue;
    }
    out[key] = sanitizeForGemini(value);
  }
  return out as T;
}

export function toFunctionDeclaration(tool: AnyToolDef): FunctionDeclaration {
  const schema = z.toJSONSchema(tool.input, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: sanitizeForGemini(schema),
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDef>();

  register(tool: AnyToolDef): void {
    if (!TOOL_NAME_PATTERN.test(tool.name)) {
      throw new Error(`Invalid tool name "${tool.name}". Names must match ${TOOL_NAME_PATTERN.source}.`);
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AnyToolDef | undefined {
    return this.tools.get(name);
  }

  list(): AnyToolDef[] {
    return [...this.tools.values()];
  }

  /** Tools exposed for the active app: unscoped tools plus those whose scope includes it. */
  toolsFor(activeApp?: string): AnyToolDef[] {
    return this.list().filter((t) => !t.appScope || (activeApp !== undefined && t.appScope.includes(activeApp)));
  }

  declarations(activeApp?: string): FunctionDeclaration[] {
    return this.toolsFor(activeApp).map(toFunctionDeclaration);
  }
}

/** Application-wide registry. Tool definitions register themselves into it. */
export const registry = new ToolRegistry();
