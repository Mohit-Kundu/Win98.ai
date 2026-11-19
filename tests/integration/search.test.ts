import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchQueryRequest, SearchQueryResponse } from '../../shared/api-contracts';
import { err, ok, type Result } from '../../shared/errors';
import { createMockGeminiClient } from '../../server/mockGemini';
import { createMetadataService, type MetadataService } from '../../src/actions/metadataService';
import { createSearchService, planWithoutAi, type SearchService } from '../../src/actions/search';
import { createSearchIndex, type SearchIndex } from '../../src/actions/searchIndex';
import { VfsDb, ROOT_ID } from '../../src/vfs/db';
import { VfsEmitter } from '../../src/vfs/events';
import { createVfsService, type VfsService } from '../../src/vfs/service';

const mock = createMockGeminiClient();
const signal = new AbortController().signal;
const DAY = 86_400_000;
const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

let n = 0;
let db: VfsDb;
let emitter: VfsEmitter;
let svc: VfsService;
let index: SearchIndex;
let meta: MetadataService;
let searchQuery: ReturnType<typeof vi.fn<(r: SearchQueryRequest) => Promise<Result<SearchQueryResponse>>>>;
let available: boolean;
let search: SearchService;

async function folderId(name: string): Promise<string> {
  const r = await svc.resolve(`C:\\${name}`);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.id;
}

async function put(folder: string, name: string, text: string, mime = 'text/plain'): Promise<string> {
  const r = await svc.create({ parentId: await folderId(folder), name, kind: 'file', bytes: enc(text), mime });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.id;
}

const names = async (text: string, extra: Parameters<SearchService['searchFiles']>[0] = {}) => {
  const r = await search.searchFiles({ ...extra, text });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.map((h) => h.name);
};

beforeEach(async () => {
  db = new VfsDb(`test-search-${n++}`);
  emitter = new VfsEmitter();
  svc = createVfsService(db, emitter);
  await svc.init();
  index = createSearchIndex({ vfs: svc });
  meta = createMetadataService({ vfs: svc, ai: { metadata: async (req) => ok(await mock.metadata(req, signal)) } });
  meta.start();
  available = true;
  searchQuery = vi.fn(async (r: SearchQueryRequest) => ok(await mock.searchQuery(r, signal)));
  search = createSearchService({ vfs: svc, index, ai: { available: async () => available, searchQuery }, now: () => Date.now() });
});

afterEach(async () => {
  await meta.whenIdle();
  meta.stop();
  index.stop();
});

describe('acceptance: "the document about machine learning"', () => {
  const upload = async () => {
    const id = await put('My Documents', 'lecture-notes.txt', 'Introduction to machine learning: models learn patterns from data.');
    await put('My Documents', 'groceries.txt', 'milk eggs bread');
    await meta.whenIdle();
    return id;
  };

  it('finds the uploaded file through AI query planning, after metadata is persisted', async () => {
    const id = await upload();
    const node = await svc.get(id);
    expect(node?.meta.category).toBe('Technology/AI');
    expect(node?.meta.aiStatus).toBe('ok');

    searchQuery.mockImplementationOnce(async () => ok({ terms: 'machine learning' }));
    const r = await search.searchNatural({ query: 'the document about machine learning' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(searchQuery).toHaveBeenCalledOnce();
    expect(searchQuery.mock.calls[0]?.[0].query).toBe('the document about machine learning');
    expect(r.value.plan.source).toBe('ai');
    expect(r.value.hits.map((h) => h.id)).toEqual([id]);
    const hit = r.value.hits[0]!;
    expect(hit).toMatchObject({
      name: 'lecture-notes.txt',
      path: 'C:\\My Documents\\lecture-notes.txt',
      location: 'C:\\My Documents',
      type: 'txt',
      category: 'Technology/AI',
    });
    expect(hit.description).toContain('machine learning');
  });

  it('finds it with raw text when AI is unavailable, without calling the planner', async () => {
    const id = await upload();
    available = false;
    const r = await search.searchNatural({ query: 'the document about machine learning' });
    expect(r.ok && r.value.plan.source).toBe('fallback');
    expect(r.ok && r.value.hits.map((h) => h.id)).toEqual([id]);
    expect(searchQuery).not.toHaveBeenCalled();
  });

  it('falls back to raw text when the AI planner fails', async () => {
    const id = await upload();
    searchQuery.mockResolvedValueOnce(err('AI_TIMEOUT', 'slow'));
    const r = await search.searchNatural({ query: 'the document about machine learning' });
    expect(r.ok && r.value.plan.source).toBe('fallback');
    expect(r.ok && r.value.hits.map((h) => h.id)).toEqual([id]);
  });

  it('matches metadata even when the body text does not contain the words', async () => {
    const id = await put('My Documents', 'scan.txt', 'zzz');
    await meta.whenIdle();
    await svc.updateMeta(id, { description: 'Overview of machine learning methods', aiEditedFields: ['description'] });
    expect(await names('machine learning')).toEqual(['scan.txt']);
  });
});

describe('index maintenance', () => {
  it('re-indexes user metadata edits, renames, content changes, and deletions', async () => {
    const id = await put('Desktop', 'a.txt', 'alpha');
    expect(await names('alpha')).toEqual(['a.txt']);
    expect(await names('zebra')).toEqual([]);

    await svc.updateMeta(id, { notes: 'my zebra notes' });
    expect(await names('zebra')).toEqual(['a.txt']);

    await svc.rename(id, 'renamed-file.txt');
    expect(await names('renamed')).toEqual(['renamed-file.txt']);

    await svc.write(id, enc('quokka content'));
    expect(await names('quokka')).toEqual(['renamed-file.txt']);
    expect(await names('alpha')).toEqual([]);

    await svc.remove(id);
    expect(await names('quokka')).toEqual([]);
  });

  it('removes descendants when a folder is deleted', async () => {
    const parent = await svc.create({ parentId: await folderId('Desktop'), name: 'Box', kind: 'folder' });
    if (!parent.ok) throw new Error('mkdir');
    await svc.create({ parentId: parent.value.id, name: 'inner.txt', kind: 'file', bytes: enc('wombat'), mime: 'text/plain' });
    expect(await names('wombat')).toEqual(['inner.txt']);
    await svc.remove(parent.value.id);
    expect(await names('wombat')).toEqual([]);
  });

  it('rebuilds from the VFS on start without persisting the index', async () => {
    await put('My Documents', 'persisted.txt', 'platypus facts');
    const fresh = createSearchIndex({ vfs: svc });
    await fresh.ready();
    expect(fresh.search('platypus').map((m) => m.doc.name)).toEqual(['persisted.txt']);
    fresh.stop();
  });

  it('indexes extracted PDF text, tags, and category', async () => {
    const id = await put('My Documents', 'paper.pdf', '%PDF-1.4', 'application/pdf');
    await svc.updateMeta(id, { extractedText: 'Quantum entanglement results', tags: ['physics'], category: 'Science/Physics' });
    expect(await names('entanglement')).toEqual(['paper.pdf']);
    expect(await names('physics')).toEqual(['paper.pdf']);
  });
});

describe('ranking and filters', () => {
  it('ranks name matches above body matches, tolerates typos and prefixes, and ignores stopwords', async () => {
    await put('Desktop', 'body.txt', 'a long essay that mentions astronomy once');
    await put('Desktop', 'astronomy-guide.txt', 'stars');
    const ranked = await names('the file about astronomy');
    expect(ranked[0]).toBe('astronomy-guide.txt');
    expect(ranked).toContain('body.txt');
    expect(await names('astronmy')).toContain('astronomy-guide.txt'); // typo
    expect(await names('astron')).toContain('astronomy-guide.txt'); // prefix
  });

  it('filters by type (jpg matches jpeg), created range, and modified range', async () => {
    await put('My Pictures', 'a.jpeg', 'x', 'image/jpeg');
    await put('My Pictures', 'b.png', 'x', 'image/png');
    await put('My Documents', 'c.pdf', 'x', 'application/pdf');
    expect(await names('', { type: 'jpg' })).toEqual(['a.jpeg']);
    expect(await names('', { type: 'folder' })).toContain('My Pictures');
    const now = Date.now();
    expect((await names('', { createdAfter: now - DAY, createdBefore: now + DAY })).length).toBeGreaterThanOrEqual(3);
    expect(await names('', { createdBefore: now - DAY })).toEqual([]);
    expect(await names('', { modifiedAfter: now + DAY })).toEqual([]);
  });

  it('rejects an empty request and a bad limit with structured errors', async () => {
    const empty = await search.searchFiles({});
    expect(!empty.ok && empty.error.code).toBe('VALIDATION');
    const bad = await search.searchFiles({ text: 'x', limit: 0 });
    expect(!bad.ok && bad.error.code).toBe('VALIDATION');
  });

  it('applies explicit UI filters on top of the plan', async () => {
    await put('My Documents', 'ml.txt', 'machine learning');
    await put('My Documents', 'machine-learning.pdf', '%PDF-1.4', 'application/pdf');
    available = false;
    const r = await search.searchNatural({ query: 'machine learning', filters: { type: 'pdf' } });
    expect(r.ok && r.value.hits.map((h) => h.name)).toEqual(['machine-learning.pdf']);
  });
});

describe('date phrases without AI', () => {
  it('parses "yesterday" into a day range and removes it from the terms', () => {
    const now = new Date(2025, 5, 18, 10, 30).getTime();
    const p = planWithoutAi('notes from yesterday', now);
    expect(p.terms).toBe('notes from');
    expect(p.createdRange).toEqual([new Date(2025, 5, 17).getTime(), new Date(2025, 5, 17).getTime() + DAY - 1]);
  });

  it('uses the modified range when the query says modified, and spans "last week" up to now', () => {
    const now = new Date(2025, 5, 18, 10, 30).getTime();
    const p = planWithoutAi('report modified last week', now);
    expect(p.createdRange).toBeUndefined();
    expect(p.modifiedRange?.[1]).toBe(now);
    expect(p.modifiedRange?.[0]).toBeLessThan(now - 6 * DAY);
  });

  it('leaves queries without dates unchanged', () => {
    expect(planWithoutAi('the document about machine learning', Date.now())).toEqual({
      terms: 'the document about machine learning',
      source: 'fallback',
    });
  });

  it('finds a file created "yesterday" relative to the clock', async () => {
    const id = await put('Desktop', 'daily.txt', 'standup');
    available = false;
    const tomorrow = createSearchService({ vfs: svc, index, ai: { available: async () => false, searchQuery }, now: () => Date.now() + DAY });
    const r = await tomorrow.searchNatural({ query: 'standup from yesterday' });
    expect(r.ok && r.value.hits.map((h) => h.id)).toEqual([id]);
    const older = createSearchService({ vfs: svc, index, ai: { available: async () => false, searchQuery }, now: () => Date.now() + 5 * DAY });
    const none = await older.searchNatural({ query: 'standup from yesterday' });
    expect(none.ok && none.value.hits).toEqual([]);
  });
});

describe('root folder', () => {
  it('is never indexed', async () => {
    await index.ready();
    expect(index.search('', { type: 'folder' }).some((m) => m.doc.id === ROOT_ID)).toBe(false);
  });
});
