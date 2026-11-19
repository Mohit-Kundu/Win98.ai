import { beforeEach, describe, expect, it } from 'vitest';
import type { MetadataRequest, MetadataResponse } from '../../shared/api-contracts';
import { err, ok, type Result } from '../../shared/errors';
import { createMetadataService, type MetadataService } from '../../src/actions/metadataService';
import { VfsDb } from '../../src/vfs/db';
import { VfsEmitter } from '../../src/vfs/events';
import { createVfsService, type VfsService } from '../../src/vfs/service';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const RESULT: MetadataResponse = { title: 'AI Title', description: 'AI desc', category: 'Tech', tags: ['x'] };

let vfs: VfsService;
let n = 0;
let docs: string;

beforeEach(async () => {
  vfs = createVfsService(new VfsDb(`test-meta-${n++}`), new VfsEmitter());
  await vfs.init();
  const r = await vfs.resolve('C:\\My Documents');
  if (!r.ok) throw new Error('no folder');
  docs = r.value.id;
});

const mkFile = async (name: string, content: string, mime = 'text/plain') => {
  const r = await vfs.create({ parentId: docs, name, kind: 'file', bytes: bytes(content), mime });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const metaOf = async (id: string) => (await vfs.get(id))!.meta;

function setup(ai: (req: MetadataRequest) => Promise<Result<MetadataResponse>>, extra: Parameters<typeof createMetadataService>[0] = {}): MetadataService {
  const svc = createMetadataService({ vfs, ai: { metadata: ai }, ...extra });
  svc.start();
  return svc;
}

describe('MetadataService', () => {
  it('goes pending then ok and stores the result with the content hash', async () => {
    const seen: Array<string | undefined> = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const svc = setup(async (req) => {
      seen.push(req.text);
      await gate;
      return ok(RESULT);
    });
    const f = await mkFile('ml.txt', 'machine learning');
    await new Promise((r) => setTimeout(r, 30));
    expect((await metaOf(f.id)).aiStatus).toBe('pending');
    release();
    await svc.whenIdle();
    const m = await metaOf(f.id);
    expect(m).toMatchObject({ aiStatus: 'ok', title: 'AI Title', category: 'Tech', tags: ['x'], aiHash: f.contentHash });
    expect(seen).toEqual(['machine learning']);
    svc.stop();
  });

  it('sets the error state and keeps the file unchanged, and retry recovers', async () => {
    let fail = true;
    const svc = setup(async () => (fail ? err('AI_UNAVAILABLE', 'Could not reach the AI service.') : ok(RESULT)));
    const f = await mkFile('a.txt', 'hello');
    await svc.whenIdle();
    expect(await metaOf(f.id)).toMatchObject({ aiStatus: 'error', aiError: 'Could not reach the AI service.' });
    const read = await vfs.read(f.id);
    expect(read.ok && new TextDecoder().decode(read.value.bytes)).toBe('hello');
    fail = false;
    svc.retry(f.id);
    await svc.whenIdle();
    expect(await metaOf(f.id)).toMatchObject({ aiStatus: 'ok', title: 'AI Title' });
    svc.stop();
  });

  it('skips regeneration when aiHash equals contentHash, and ignores metaChanged', async () => {
    let calls = 0;
    const svc = setup(async () => {
      calls++;
      return ok(RESULT);
    });
    const f = await mkFile('a.txt', 'same');
    await svc.whenIdle();
    expect(calls).toBe(1);
    await vfs.write(f.id, bytes('same')); // identical bytes -> identical hash
    await svc.whenIdle();
    await vfs.updateMeta(f.id, { notes: 'n' });
    await svc.whenIdle();
    expect(calls).toBe(1);
    await vfs.write(f.id, bytes('different'));
    await svc.whenIdle();
    expect(calls).toBe(2);
    svc.stop();
  });

  it('never overwrites fields listed in aiEditedFields', async () => {
    const svc = setup(async () => ok(RESULT));
    const f = await mkFile('a.txt', 'one');
    await svc.whenIdle();
    await vfs.updateMeta(f.id, { title: 'Mine', aiEditedFields: ['title'] });
    await vfs.write(f.id, bytes('two'));
    await svc.whenIdle();
    expect(await metaOf(f.id)).toMatchObject({ title: 'Mine', description: 'AI desc', aiStatus: 'ok' });
    svc.stop();
  });

  it('runs at most 2 analyses at once', async () => {
    let active = 0;
    let peak = 0;
    const svc = setup(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return ok(RESULT);
    });
    for (let i = 0; i < 5; i++) await mkFile(`f${i}.txt`, `text ${i}`);
    await svc.whenIdle();
    expect(peak).toBe(2);
    expect((await vfs.list(docs)).every((x) => x.meta.aiStatus === 'ok')).toBe(true);
    svc.stop();
  });

  it('extracts PDF text into meta.extractedText and sends truncated text', async () => {
    const long = 'p'.repeat(30_000);
    const reqs: MetadataRequest[] = [];
    const svc = setup(
      async (req) => {
        reqs.push(req);
        return ok(RESULT);
      },
      { extractPdfText: async () => long },
    );
    const f = await mkFile('doc.pdf', '%PDF-stub', 'application/pdf');
    await svc.whenIdle();
    expect(reqs[0]).toMatchObject({ kind: 'pdf', name: 'doc.pdf' });
    expect(reqs[0]!.text).toHaveLength(20_000);
    expect((await metaOf(f.id)).extractedText).toBe(long);
    svc.stop();
  });

  it('marks a PDF error when extraction fails, and sends downscaled image data for images', async () => {
    const reqs: MetadataRequest[] = [];
    const svc = setup(
      async (req) => {
        reqs.push(req);
        return ok(RESULT);
      },
      {
        extractPdfText: async () => {
          throw new Error('bad pdf');
        },
        prepareImage: async () => 'c21hbGw=',
      },
    );
    const pdf = await mkFile('bad.pdf', 'x', 'application/pdf');
    const img = await mkFile('p.png', 'png-bytes', 'image/png');
    await svc.whenIdle();
    expect((await metaOf(pdf.id)).aiStatus).toBe('error');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ kind: 'image', imageBase64: 'c21hbGw=' });
    expect((await metaOf(img.id)).aiStatus).toBe('ok');
    svc.stop();
  });

  it('resumes analyses left pending on start', async () => {
    const f = await mkFile('a.txt', 'resume me');
    await vfs.updateMeta(f.id, { aiStatus: 'pending' });
    const svc = setup(async () => ok(RESULT));
    await new Promise((r) => setTimeout(r, 30));
    await svc.whenIdle();
    expect((await metaOf(f.id)).aiStatus).toBe('ok');
    svc.stop();
  });
});
