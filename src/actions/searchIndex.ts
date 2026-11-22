import MiniSearch from 'minisearch';
import { ROOT_ID, type NodeRecord } from '../vfs/db';
import type { VfsEvent } from '../vfs/events';
import { vfs as sharedVfs, type VfsService } from '../vfs/service';
import { extensionOf } from './associations';
import { parseWpd, tiptapToPlainText } from './wordpad/format';

/** Indexed body text is capped so a huge file cannot dominate memory. */
export const MAX_INDEXED_TEXT = 200 * 1024;

export interface SearchDoc {
  id: string;
  name: string;
  text: string;
  extractedText: string;
  title: string;
  description: string;
  category: string;
  tags: string;
  notes: string;
  ext: string;
  kind: 'file' | 'folder';
  createdAt: number;
  modifiedAt: number;
}

export interface SearchFilters {
  /** File extension (`pdf`, `txt`, ...) or `folder`. `jpg` and `jpeg` are treated as the same type. */
  type?: string;
  createdAfter?: number;
  createdBefore?: number;
  modifiedAfter?: number;
  modifiedBefore?: number;
}

export interface IndexMatch {
  doc: SearchDoc;
  score: number;
}

export interface SearchIndex {
  /** Subscribe to VFS events and build the index from the VFS. Safe to call twice. */
  start(): void;
  stop(): void;
  /** Resolves when the initial build and every queued update has finished. Starts the index when needed. */
  ready(): Promise<void>;
  /** Text matches ranked by score. With empty `text`, every document passing the filters (newest first). */
  search(text: string, filters?: SearchFilters): IndexMatch[];
  /** Distinct non-empty AI categories, for the query planner. */
  categories(): string[];
  size(): number;
}

const STOPWORDS = new Set(
  ('a an and are as at be but by for from has have i in is it its me my of on or that the their there these this those to was were what when where which who will with you your about into over under than then them they we us ' +
    'find show list get give search looking look any all some').split(' '),
);
/** Words that describe the request, not the file. Dropped from queries only so names like "Document1" still match. */
const QUERY_NOISE = new Set(['document', 'documents', 'doc', 'docs', 'file', 'files', 'folder', 'folders', 'created', 'modified', 'edited', 'saved', 'made', 'updated', 'changed']);

const normalize = (term: string): string => term.toLowerCase();
const processIndexTerm = (term: string): string | null => {
  const t = normalize(term);
  return STOPWORDS.has(t) ? null : t;
};
const processQueryTerm = (term: string): string | null => {
  const t = normalize(term);
  return STOPWORDS.has(t) || QUERY_NOISE.has(t) ? null : t;
};

const typeKey = (ext: string): string => (ext === 'jpeg' ? 'jpg' : ext);

/** True when `text` has at least one term that can match (not only stopwords and request words). */
export function hasSearchTerms(text: string): boolean {
  const tokenize = MiniSearch.getDefault('tokenize') as (s: string) => string[];
  return tokenize(text).some((t) => t !== '' && processQueryTerm(t) !== null);
}

function toDoc(node: NodeRecord, text: string): SearchDoc {
  const m = node.meta;
  return {
    id: node.id,
    name: node.name,
    text,
    extractedText: m.extractedText ?? '',
    title: m.title ?? '',
    description: m.description ?? '',
    category: m.category ?? '',
    tags: (m.tags ?? []).join(' '),
    notes: m.notes ?? '',
    ext: node.ext ?? '',
    kind: node.kind,
    createdAt: node.createdAt,
    modifiedAt: node.modifiedAt,
  };
}

function passes(doc: SearchDoc, f: SearchFilters): boolean {
  if (f.type !== undefined) {
    const want = typeKey(f.type.toLowerCase());
    if (want === 'folder' ? doc.kind !== 'folder' : doc.kind !== 'file' || typeKey(doc.ext) !== want) return false;
  }
  if (f.createdAfter !== undefined && doc.createdAt < f.createdAfter) return false;
  if (f.createdBefore !== undefined && doc.createdAt > f.createdBefore) return false;
  if (f.modifiedAfter !== undefined && doc.modifiedAt < f.modifiedAfter) return false;
  if (f.modifiedBefore !== undefined && doc.modifiedAt > f.modifiedBefore) return false;
  return true;
}

export function createSearchIndex(deps: { vfs?: VfsService } = {}): SearchIndex {
  const vfs = deps.vfs ?? sharedVfs;
  const mini = new MiniSearch<SearchDoc>({
    fields: ['name', 'text', 'extractedText', 'title', 'description', 'category', 'tags', 'notes'],
    storeFields: [],
    processTerm: processIndexTerm,
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'OR',
      processTerm: processQueryTerm,
      boost: { name: 3, title: 2, tags: 2, category: 1.5, description: 1.5 },
    },
  });
  const docs = new Map<string, SearchDoc>();
  /** Body text per node, so renames and metadata edits do not re-read content. */
  const bodies = new Map<string, string>();
  let chain: Promise<void> = Promise.resolve();
  let unsubscribe: (() => void) | undefined;

  const put = (doc: SearchDoc): void => {
    if (mini.has(doc.id)) mini.replace(doc);
    else mini.add(doc);
    docs.set(doc.id, doc);
  };

  const drop = (id: string): void => {
    if (mini.has(id)) mini.discard(id);
    docs.delete(id);
    bodies.delete(id);
  };

  const readBody = async (node: NodeRecord): Promise<string> => {
    const ext = extensionOf(node.name);
    if (node.kind !== 'file' || (ext !== 'txt' && ext !== 'md' && ext !== 'wpd')) return '';
    const r = await vfs.read(node.id);
    if (!r.ok) return '';
    try {
      if (ext === 'wpd') {
        const doc = parseWpd(r.value.bytes);
        return doc.ok ? tiptapToPlainText(doc.value).slice(0, MAX_INDEXED_TEXT) : '';
      }
      return new TextDecoder().decode(r.value.bytes).slice(0, MAX_INDEXED_TEXT);
    } catch {
      return '';
    }
  };

  /** Re-index one node from the VFS. `reload` re-reads the body text. */
  const refresh = async (id: string, reload: boolean): Promise<void> => {
    const node = await vfs.get(id);
    // System folders, app shortcuts and anything in the Recycle Bin are not searchable.
    if (!node || node.id === ROOT_ID || node.system || (await vfs.isInBin(id))) return drop(id);
    if (reload || !bodies.has(id)) bodies.set(id, await readBody(node));
    put(toDoc(node, bodies.get(id) ?? ''));
  };

  /** A deleted folder takes its descendants with it, and the event names only the folder. */
  const prune = async (): Promise<void> => {
    for (const id of [...docs.keys()]) if (!(await vfs.get(id)) || (await vfs.isInBin(id))) drop(id);
  };

  const build = async (): Promise<void> => {
    const stack = [ROOT_ID];
    const seen = new Set<string>();
    while (stack.length > 0) {
      for (const n of await vfs.list(stack.pop()!)) {
        if (n.system) continue;
        seen.add(n.id);
        if (n.kind === 'folder') stack.push(n.id);
        bodies.set(n.id, await readBody(n));
        put(toDoc(n, bodies.get(n.id) ?? ''));
      }
    }
    for (const id of [...docs.keys()]) if (!seen.has(id)) drop(id);
  };

  /** Index every descendant of a folder. */
  const addSubtree = async (folderId: string): Promise<void> => {
    const stack = [folderId];
    while (stack.length > 0) {
      for (const n of await vfs.list(stack.pop()!)) {
        if (n.system) continue;
        if (n.kind === 'folder') stack.push(n.id);
        bodies.set(n.id, await readBody(n));
        put(toDoc(n, bodies.get(n.id) ?? ''));
      }
    }
  };

  const enqueue = (task: () => Promise<void>): void => {
    chain = chain.then(task).catch((e: unknown) => console.error('Search index update failed', e));
  };

  const onEvent = (e: VfsEvent): void => {
    if (e.type === 'deleted') {
      const wasFolder = docs.get(e.nodeId)?.kind === 'folder';
      drop(e.nodeId);
      if (wasFolder) enqueue(prune);
      return;
    }
    enqueue(async () => {
      await refresh(e.nodeId, e.type === 'created' || e.type === 'updated');
      // A restored folder brings its descendants back into the index.
      if (e.type === 'created' && docs.get(e.nodeId)?.kind === 'folder') await addSubtree(e.nodeId);
    });
  };

  const start = (): void => {
    if (unsubscribe) return;
    unsubscribe = vfs.subscribe(onEvent);
    enqueue(build);
  };

  return {
    start,
    stop() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
    ready() {
      start();
      return chain;
    },
    search(text, filters = {}) {
      const trimmed = text.trim();
      if (!hasSearchTerms(trimmed)) {
        const all = [...docs.values()].filter((d) => passes(d, filters)).sort((a, b) => b.modifiedAt - a.modifiedAt);
        return all.map((doc) => ({ doc, score: 0 }));
      }
      const out: IndexMatch[] = [];
      for (const r of mini.search(trimmed)) {
        const doc = docs.get(r.id as string);
        if (doc && passes(doc, filters)) out.push({ doc, score: r.score });
      }
      return out;
    },
    categories() {
      return [...new Set([...docs.values()].map((d) => d.category).filter((c) => c !== ''))];
    },
    size() {
      return docs.size;
    },
  };
}

/** Application-wide index. Rebuilt from the VFS on every page load and never persisted. */
export const searchIndex: SearchIndex = createSearchIndex();
