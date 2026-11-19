import * as chrono from 'chrono-node';
import type { FileType, SearchQueryRequest, SearchQueryResponse } from '../../shared/api-contracts';
import { err, ok, type Result } from '../../shared/errors';
import { aiClient, isAiAvailable } from '../ai/client';
import { vfs as sharedVfs, type VfsService } from '../vfs/service';
import { searchIndex as sharedIndex, type SearchFilters, type SearchIndex } from './searchIndex';

/** Shared query planning and file search over the Search_Index (Req 5). */
export const DEFAULT_SEARCH_LIMIT = 50;
export const MAX_SEARCH_LIMIT = 200;

export interface SearchFilesInput {
  /** Keywords. May be empty when a filter is given. */
  text?: string;
  /** File extension (pdf, txt, md, wpd, png, jpg, jpeg) or `folder`. */
  type?: FileType;
  /** Epoch milliseconds, inclusive. */
  createdAfter?: number;
  createdBefore?: number;
  modifiedAfter?: number;
  modifiedBefore?: number;
  limit?: number;
}

/** One search result with everything the result view shows (Req 5.2). */
export interface SearchHit {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  /** Extension, or `folder`. */
  type: string;
  /** Full path of the node. */
  path: string;
  /** Path of the folder that holds the node. */
  location: string;
  title: string;
  description: string;
  category: string;
  createdAt: number;
  modifiedAt: number;
  score: number;
}

export type Range = [number, number];

export interface SearchPlan {
  terms: string;
  type?: FileType;
  createdRange?: Range;
  modifiedRange?: Range;
  /** `ai` when Gemini planned the query, `fallback` for raw text plus local date parsing. */
  source: 'ai' | 'fallback';
}

export interface SearchActions {
  searchFiles(i: SearchFilesInput): Promise<Result<SearchHit[]>>;
}

export interface NaturalSearchInput {
  query: string;
  /** Explicit filters from the UI. They narrow the plan: the type replaces it, ranges intersect. */
  filters?: Omit<SearchFilesInput, 'text' | 'limit'>;
  limit?: number;
}

export interface SearchService extends SearchActions {
  planQuery(query: string): Promise<SearchPlan>;
  searchNatural(i: NaturalSearchInput): Promise<Result<{ plan: SearchPlan; hits: SearchHit[] }>>;
}

export interface SearchDeps {
  vfs?: VfsService;
  index?: SearchIndex;
  ai?: {
    available(): Promise<boolean>;
    searchQuery(req: SearchQueryRequest): Promise<Result<SearchQueryResponse>>;
  };
  now?: () => number;
}

const DAY = 86_400_000;
const startOfDay = (ms: number): number => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();
const endOfDay = (ms: number): number => startOfDay(ms) + DAY - 1;
const MODIFIED_WORDS = /\b(?:modified|edited|updated|changed|saved)\b/i;
const RELATIVE_SPAN = /^(?:in\s+)?(?:the\s+)?(?:last|past|previous)\s+(?:\d+\s+|few\s+)?(?:day|week|month|year)s?$/i;

/** Turn raw text into terms plus date ranges, without any AI call (Req 5.4). */
export function planWithoutAi(query: string, now: number): SearchPlan {
  const plan: SearchPlan = { terms: query.trim(), source: 'fallback' };
  const parsed = chrono.parse(query, new Date(now));
  const first = parsed[0];
  if (!first) return plan;

  const start = first.start.date().getTime();
  const before = query.slice(0, first.index).trimEnd().toLowerCase();
  let range: Range;
  if (RELATIVE_SPAN.test(first.text.trim())) {
    range = [start, now];
  } else if (first.end) {
    range = [start, first.end.date().getTime()];
  } else if (!first.start.isCertain('day') && first.start.isCertain('month')) {
    const d = new Date(start);
    range = [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1];
  } else if (/(?:^|\s)(?:since|after)$/.test(before)) {
    range = [startOfDay(start), now];
  } else if (/(?:^|\s)before$/.test(before)) {
    range = [0, startOfDay(start) - 1];
  } else {
    range = [startOfDay(start), endOfDay(start)];
  }
  if (MODIFIED_WORDS.test(query)) plan.modifiedRange = range;
  else plan.createdRange = range;
  plan.terms = `${query.slice(0, first.index)} ${query.slice(first.index + first.text.length)}`.replace(/\s+/g, ' ').trim();
  return plan;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function intersect(a: Range | undefined, after: number | undefined, before: number | undefined): { after?: number; before?: number } {
  const lo = [a?.[0], after].filter((v): v is number => v !== undefined);
  const hi = [a?.[1], before].filter((v): v is number => v !== undefined);
  return {
    ...(lo.length ? { after: Math.max(...lo) } : {}),
    ...(hi.length ? { before: Math.min(...hi) } : {}),
  };
}

export function createSearchService(deps: SearchDeps = {}): SearchService {
  const vfs = deps.vfs ?? sharedVfs;
  const index = deps.index ?? sharedIndex;
  const ai = deps.ai ?? { available: () => isAiAvailable(), searchQuery: (r: SearchQueryRequest) => aiClient.searchQuery(r) };
  const now = deps.now ?? Date.now;

  const run = async (i: SearchFilesInput): Promise<Result<SearchHit[]>> => {
    const limit = i.limit ?? DEFAULT_SEARCH_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
      return err('VALIDATION', `limit must be a whole number from 1 to ${MAX_SEARCH_LIMIT}.`);
    }
    const filters: SearchFilters = {
      ...(i.type !== undefined ? { type: i.type } : {}),
      ...(i.createdAfter !== undefined ? { createdAfter: i.createdAfter } : {}),
      ...(i.createdBefore !== undefined ? { createdBefore: i.createdBefore } : {}),
      ...(i.modifiedAfter !== undefined ? { modifiedAfter: i.modifiedAfter } : {}),
      ...(i.modifiedBefore !== undefined ? { modifiedBefore: i.modifiedBefore } : {}),
    };
    const text = i.text?.trim() ?? '';
    if (text === '' && Object.keys(filters).length === 0) return err('VALIDATION', 'Provide search text or a filter.');
    await index.ready();
    const hits: SearchHit[] = [];
    for (const { doc, score } of index.search(text, filters).slice(0, limit)) {
      const path = await vfs.pathOf(doc.id);
      if (path === '') continue; // removed while searching
      const cut = path.lastIndexOf('\\');
      hits.push({
        id: doc.id,
        name: doc.name,
        kind: doc.kind,
        type: doc.kind === 'folder' ? 'folder' : doc.ext,
        path,
        location: cut <= 2 ? 'C:\\' : path.slice(0, cut),
        title: doc.title,
        description: doc.description,
        category: doc.category,
        createdAt: doc.createdAt,
        modifiedAt: doc.modifiedAt,
        score,
      });
    }
    return ok(hits);
  };

  const planQuery = async (query: string): Promise<SearchPlan> => {
    const t = now();
    try {
      if (await ai.available()) {
        await index.ready();
        const r = await ai.searchQuery({ query: query.trim(), now: new Date(t).toISOString(), categories: index.categories().slice(0, 200) });
        if (r.ok) {
          const v = r.value;
          return {
            terms: v.terms,
            ...(v.type ? { type: v.type } : {}),
            ...(v.createdRange ? { createdRange: v.createdRange } : {}),
            ...(v.modifiedRange ? { modifiedRange: v.modifiedRange } : {}),
            source: 'ai',
          };
        }
      }
    } catch (e) {
      console.warn('Search query planning failed, using raw text', message(e));
    }
    return planWithoutAi(query, t);
  };

  return {
    searchFiles: async (i) => {
      try {
        return await run(i ?? {});
      } catch (e) {
        return err('WRITE_FAILED', 'The search failed unexpectedly.', { cause: message(e) });
      }
    },

    planQuery,

    async searchNatural(i) {
      try {
        const query = i?.query?.trim() ?? '';
        const f = i?.filters ?? {};
        if (query === '' && Object.keys(f).length === 0) return err('VALIDATION', 'Enter something to search for.');
        const plan = query === '' ? ({ terms: '', source: 'fallback' } as SearchPlan) : await planQuery(query);
        const created = intersect(plan.createdRange, f.createdAfter, f.createdBefore);
        const modified = intersect(plan.modifiedRange, f.modifiedAfter, f.modifiedBefore);
        const type = f.type ?? plan.type;
        const r = await run({
          text: plan.terms,
          ...(type ? { type } : {}),
          ...(created.after !== undefined ? { createdAfter: created.after } : {}),
          ...(created.before !== undefined ? { createdBefore: created.before } : {}),
          ...(modified.after !== undefined ? { modifiedAfter: modified.after } : {}),
          ...(modified.before !== undefined ? { modifiedBefore: modified.before } : {}),
          ...(i.limit !== undefined ? { limit: i.limit } : {}),
        });
        if (!r.ok) return r;
        return ok({ plan, hits: r.value });
      } catch (e) {
        return err('WRITE_FAILED', 'The search failed unexpectedly.', { cause: message(e) });
      }
    },
  };
}
