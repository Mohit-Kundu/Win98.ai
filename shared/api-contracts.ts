import { z } from 'zod';

/**
 * Zod schemas for every /api request and response. Shared by client and server.
 * The server enforces a 10 MB JSON body limit (express.json) before these run.
 */

export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export const FILE_TYPES = ['pdf', 'txt', 'md', 'wpd', 'png', 'jpg', 'jpeg', 'folder'] as const;
export const FileTypeSchema = z.enum(FILE_TYPES);
export type FileType = z.infer<typeof FileTypeSchema>;

/** Base64 payload cap, kept under the 10 MB body limit. */
const base64 = z.string().min(1).max(9_000_000);

// ---------- Error envelope ----------

export const ApiErrorCodeSchema = z.enum([
  'VALIDATION',
  'TOO_LARGE',
  'AI_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_FAILED',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    issues: z.array(z.unknown()).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

// ---------- GET /api/health ----------

export const HealthResponseSchema = z.object({ ok: z.literal(true), ai: z.boolean() });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---------- POST /api/chat ----------

/**
 * A Gemini content part. Loose so unknown keys (e.g. `thoughtSignature`, `thought`)
 * survive validation and the model turn can be echoed back verbatim.
 */
export const PartSchema = z.looseObject({
  text: z.string().optional(),
  thought: z.boolean().optional(),
  thoughtSignature: z.string().optional(),
  functionCall: z
    .looseObject({
      id: z.string().optional(),
      name: z.string().min(1),
      args: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  functionResponse: z
    .looseObject({
      id: z.string().optional(),
      name: z.string().min(1),
      response: z.record(z.string(), z.unknown()),
    })
    .optional(),
  inlineData: z.looseObject({ mimeType: z.string(), data: z.string() }).optional(),
});
export type Part = z.infer<typeof PartSchema>;

export const ContentSchema = z.looseObject({
  role: z.enum(['user', 'model']),
  parts: z.array(PartSchema).min(1),
});
export type Content = z.infer<typeof ContentSchema>;

export const FunctionDeclarationSchema = z.looseObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
  description: z.string(),
  parametersJsonSchema: z.record(z.string(), z.unknown()).optional(),
});
export type FunctionDeclaration = z.infer<typeof FunctionDeclarationSchema>;

export const ChatRequestSchema = z.object({
  contents: z.array(ContentSchema).min(1).max(200),
  tools: z.array(FunctionDeclarationSchema).max(64),
  systemContext: z.string().max(20_000).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const FunctionCallItemSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
});
export type FunctionCallItem = z.infer<typeof FunctionCallItemSchema>;

export const ChatResponseSchema = z.object({
  modelContent: ContentSchema,
  text: z.string().optional(),
  functionCalls: z.array(FunctionCallItemSchema),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// ---------- POST /api/generate-image ----------

export const GenerateImageRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  aspect: z.enum(['1:1', '4:3', '16:9']).optional(),
});
export type GenerateImageRequest = z.infer<typeof GenerateImageRequestSchema>;

export const GenerateImageResponseSchema = z.object({
  mimeType: z.string().min(1),
  dataBase64: base64,
});
export type GenerateImageResponse = z.infer<typeof GenerateImageResponseSchema>;

// ---------- POST /api/metadata ----------

export const MetadataRequestSchema = z.object({
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(255),
  kind: z.enum(['text', 'image', 'pdf']),
  text: z.string().max(20_000).optional(),
  imageBase64: base64.optional(),
});
export type MetadataRequest = z.infer<typeof MetadataRequestSchema>;

export const MetadataResponseSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
});
export type MetadataResponse = z.infer<typeof MetadataResponseSchema>;

// ---------- POST /api/search-query ----------

const RangeSchema = z.tuple([z.number(), z.number()]);

export const SearchQueryRequestSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  now: z.iso.datetime({ offset: true }),
  categories: z.array(z.string().max(200)).max(200).optional(),
});
export type SearchQueryRequest = z.infer<typeof SearchQueryRequestSchema>;

export const SearchQueryResponseSchema = z.object({
  terms: z.string(),
  type: FileTypeSchema.optional(),
  createdRange: RangeSchema.optional(),
  modifiedRange: RangeSchema.optional(),
});
export type SearchQueryResponse = z.infer<typeof SearchQueryResponseSchema>;

// ---------- POST /api/organize ----------

export const OrganizeFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(50),
  title: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type OrganizeFile = z.infer<typeof OrganizeFileSchema>;

export const OrganizeRequestSchema = z.object({
  files: z.array(OrganizeFileSchema).min(1).max(500),
  folders: z.array(z.string().max(1000)).max(1000),
});
export type OrganizeRequest = z.infer<typeof OrganizeRequestSchema>;

export const OrganizeResponseSchema = z.object({
  moves: z.array(z.object({ fileId: z.string().min(1), destination: z.string().min(1) })),
});
export type OrganizeResponse = z.infer<typeof OrganizeResponseSchema>;

// ---------- POST /api/text-transform ----------

export const TEXT_TRANSFORM_MODES = ['generate', 'rewrite', 'summarize', 'proofread', 'expand'] as const;
export const TextTransformModeSchema = z.enum(TEXT_TRANSFORM_MODES);

export const TextTransformRequestSchema = z
  .object({
    mode: TextTransformModeSchema,
    text: z.string().max(100_000).optional(),
    instruction: z.string().max(4000).optional(),
  })
  .refine((v) => v.mode === 'generate' || (v.text !== undefined && v.text.length > 0), {
    message: 'text is required unless mode is generate',
    path: ['text'],
  })
  .refine((v) => v.mode !== 'generate' || !!(v.instruction?.trim() || v.text?.trim()), {
    message: 'generate requires instruction or text',
    path: ['instruction'],
  });
export type TextTransformRequest = z.infer<typeof TextTransformRequestSchema>;

export const TextTransformResponseSchema = z.object({ text: z.string() });
export type TextTransformResponse = z.infer<typeof TextTransformResponseSchema>;
