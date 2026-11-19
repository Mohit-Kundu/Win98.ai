import type { MetadataRequest, MetadataResponse } from '../../shared/api-contracts';
import { err, ok, type Result } from '../../shared/errors';
import { aiClient } from '../ai/client';
import { ROOT_ID, type NodeMeta, type NodeRecord } from '../vfs/db';
import { vfs as sharedVfs, type VfsService } from '../vfs/service';
import { extensionOf } from './associations';
import {
  extractPdfText as defaultExtractPdfText,
  MAX_EXTRACTED_CHARS,
  prepareImageForAnalysis,
  type ImagePreparer,
  type PdfTextExtractor,
} from './metadataExtractors';
import { parseWpd, tiptapToPlainText } from './wordpad/format';

/** Text sent to the AI proxy is capped by the request contract. */
export const MAX_METADATA_TEXT = 20_000;
export const METADATA_CONCURRENCY = 2;

type AiField = NonNullable<NodeMeta['aiEditedFields']>[number];

export interface MetadataServiceDeps {
  vfs?: VfsService;
  ai?: { metadata(req: MetadataRequest): Promise<Result<MetadataResponse>> };
  extractPdfText?: PdfTextExtractor;
  prepareImage?: ImagePreparer;
  concurrency?: number;
}

export interface MetadataService {
  /** Subscribe to VFS events and resume analyses left pending by a previous session. Safe to call twice. */
  start(): void;
  stop(): void;
  /** Queue a fresh analysis, for example from the Explorer "Retry analysis" command. */
  retry(nodeId: string): void;
  /** Resolves when nothing is queued or running. */
  whenIdle(): Promise<void>;
}

type Kind = MetadataRequest['kind'];

function kindOf(node: NodeRecord): Kind | null {
  const ext = extensionOf(node.name);
  if (ext === 'txt' || ext === 'md' || ext === 'wpd') return 'text';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'image';
  if (ext === 'pdf') return 'pdf';
  return null;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createMetadataService(deps: MetadataServiceDeps = {}): MetadataService {
  const vfs = deps.vfs ?? sharedVfs;
  const ai = deps.ai ?? aiClient;
  const extractPdfText = deps.extractPdfText ?? defaultExtractPdfText;
  const prepareImage = deps.prepareImage ?? prepareImageForAnalysis;
  const limit = Math.max(1, deps.concurrency ?? METADATA_CONCURRENCY);

  const queue: string[] = [];
  const queued = new Set<string>();
  const running = new Set<string>();
  const dirty = new Set<string>();
  let idleWaiters: Array<() => void> = [];
  let unsubscribe: (() => void) | undefined;

  const settleIdle = (): void => {
    if (queue.length > 0 || running.size > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  };

  const fail = async (id: string, text: string): Promise<void> => {
    await vfs.updateMeta(id, { aiStatus: 'error', aiError: text });
  };

  /** Build the minimal request body for a file. Returns null when there is nothing to analyze. */
  const buildRequest = async (node: NodeRecord, bytes: ArrayBuffer): Promise<Result<{ req: MetadataRequest; extracted?: string } | null>> => {
    const kind = kindOf(node);
    if (!kind) return ok(null);
    const mime = node.mime ?? 'application/octet-stream';
    const base = { name: node.name, mime, kind } as const;
    if (kind === 'text') {
      let text: string;
      if (extensionOf(node.name) === 'wpd') {
        const doc = parseWpd(bytes);
        if (!doc.ok) return err('VALIDATION', doc.error.message);
        text = tiptapToPlainText(doc.value);
      } else {
        text = new TextDecoder().decode(bytes);
      }
      if (text.trim() === '') return ok(null);
      return ok({ req: { ...base, text: text.slice(0, MAX_METADATA_TEXT) } });
    }
    if (kind === 'pdf') {
      const full = (await extractPdfText(bytes)).slice(0, MAX_EXTRACTED_CHARS);
      const text = full.slice(0, MAX_METADATA_TEXT);
      return ok({ req: text ? { ...base, text } : { ...base }, extracted: full });
    }
    return ok({ req: { ...base, imageBase64: await prepareImage(bytes, mime) } });
  };

  const analyze = async (id: string): Promise<void> => {
    const node = await vfs.get(id);
    if (!node || node.kind !== 'file' || !kindOf(node)) return;
    const status = node.meta.aiStatus;
    if (node.contentHash && node.meta.aiHash === node.contentHash && status !== 'error' && status !== 'pending') return;

    const startHash = node.contentHash;
    const read = await vfs.read(id);
    if (!read.ok) return;

    let built: Result<{ req: MetadataRequest; extracted?: string } | null>;
    try {
      built = await buildRequest(node, read.value.bytes);
    } catch (e) {
      await fail(id, `Could not read the file for analysis: ${message(e)}`);
      return;
    }
    if (!built.ok) {
      await fail(id, built.error.message);
      return;
    }
    if (built.value === null) return;
    const { req, extracted } = built.value;

    await vfs.updateMeta(id, { aiStatus: 'pending', aiError: undefined, ...(extracted !== undefined ? { extractedText: extracted } : {}) });

    let result: Result<MetadataResponse>;
    try {
      result = await ai.metadata(req);
    } catch (e) {
      result = err('AI_FAILED', message(e));
    }

    // Re-read: the user may have edited fields or the content may have changed during the call.
    const latest = await vfs.get(id);
    if (!latest) return;
    if (latest.contentHash !== startHash) return; // a newer analysis is already queued by the 'updated' event

    if (!result.ok) {
      await fail(id, result.error.message);
      return;
    }
    const edited = new Set<AiField>(latest.meta.aiEditedFields ?? []);
    const patch: Partial<NodeMeta> = { aiStatus: 'ok', aiError: undefined };
    if (startHash) patch.aiHash = startHash;
    if (!edited.has('title')) patch.title = result.value.title;
    if (!edited.has('description')) patch.description = result.value.description;
    if (!edited.has('category')) patch.category = result.value.category;
    if (!edited.has('tags')) patch.tags = result.value.tags;
    await vfs.updateMeta(id, patch);
  };

  const run = async (id: string): Promise<void> => {
    try {
      await analyze(id);
    } catch (e) {
      try {
        await fail(id, message(e));
      } catch {
        /* the node may be gone */
      }
    }
  };

  const pump = (): void => {
    while (running.size < limit && queue.length > 0) {
      const id = queue.shift()!;
      queued.delete(id);
      running.add(id);
      void run(id).finally(() => {
        running.delete(id);
        if (dirty.delete(id)) enqueue(id);
        pump();
        settleIdle();
      });
    }
  };

  function enqueue(id: string): void {
    if (running.has(id)) {
      dirty.add(id);
      return;
    }
    if (queued.has(id)) return;
    queued.add(id);
    queue.push(id);
    pump();
  }

  const resumePending = async (): Promise<void> => {
    const stack = [ROOT_ID];
    while (stack.length > 0) {
      const items = await vfs.list(stack.pop()!);
      for (const n of items) {
        if (n.kind === 'folder') stack.push(n.id);
        else if (n.meta.aiStatus === 'pending') enqueue(n.id);
      }
    }
  };

  return {
    start() {
      if (unsubscribe) return;
      // Only created and content-updated events. metaChanged is ignored so our own writes cannot loop.
      unsubscribe = vfs.subscribe((e) => {
        if (e.type === 'created' || e.type === 'updated') enqueue(e.nodeId);
      });
      void resumePending().catch(() => undefined);
    },
    stop() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
    retry(nodeId) {
      enqueue(nodeId);
    },
    whenIdle() {
      if (queue.length === 0 && running.size === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}

/** Application-wide service. Started once from main.tsx. */
export const metadataService: MetadataService = createMetadataService();
