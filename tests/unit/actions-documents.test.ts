import { describe, it, expect, beforeEach } from 'vitest';
import { VfsDb } from '../../src/vfs/db';
import { VfsEmitter } from '../../src/vfs/events';
import { createVfsService, type VfsService } from '../../src/vfs/service';
import { createCoreActions } from '../../src/actions/core';
import { createDocumentActions, type DocumentActions } from '../../src/actions/documents';
import { DocumentBus, type DocumentUpdate } from '../../src/actions/wordpad/documentBus';
import {
  htmlToTiptapJson,
  parseWpd,
  sanitizeHtml,
  serializeWpd,
  tiptapToPlainText,
  type TipTapJSON,
} from '../../src/actions/wordpad/format';

const val = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let svc: VfsService;
let docs: DocumentActions;
let bus: DocumentBus;
let events: DocumentUpdate[];
let n = 0;

beforeEach(async () => {
  svc = createVfsService(new VfsDb(`test-docs-${n++}`), new VfsEmitter());
  await svc.init();
  const core = createCoreActions({ vfs: svc, launch: () => 'w' });
  bus = new DocumentBus();
  events = [];
  bus.subscribe((e) => events.push(e));
  docs = createDocumentActions({ vfs: svc, core, bus });
});

const readDoc = async (id: string): Promise<TipTapJSON> => val(parseWpd(val(await svc.read(id)).bytes));

describe('sanitizeHtml', () => {
  it('strips scripts, event handlers, javascript: URLs, and images', () => {
    const out = sanitizeHtml(
      '<p onclick="x()">hi<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">l</a><a href="https://ok.test/">k</a></p>',
    );
    expect(out).not.toMatch(/script|onerror|onclick|<img|javascript:/i);
    expect(out).toContain('https://ok.test/');
    expect(sanitizeHtml(out)).toBe(out);
  });
});

describe('format', () => {
  it('round-trips a document and extracts plain text', () => {
    const doc = htmlToTiptapJson('<h1>Title</h1><p>a <strong>b</strong> <u>c</u></p><ul><li>one</li><li>two</li></ul>');
    expect(val(parseWpd(serializeWpd(doc)))).toEqual(doc);
    expect(tiptapToPlainText(doc)).toBe('Title\na b c\none\ntwo');
  });
  it('rejects invalid files', () => {
    expect(parseWpd(new TextEncoder().encode('{"version":2}').buffer as ArrayBuffer)).toMatchObject({ ok: false });
  });
});

describe('document actions', () => {
  it('creates a document, enforces the overwrite policy, and emits on the bus', async () => {
    const c = val(await docs.createDocument({ path: 'C:\\My Documents\\Report', contentHtml: '<h1>A</h1><p>x</p>' }));
    expect(c.path).toBe('C:\\My Documents\\Report.wpd');
    expect(events).toHaveLength(1);
    expect(await docs.createDocument({ path: c.path, contentHtml: '<p>y</p>' })).toMatchObject({ ok: false, error: { code: 'CONFLICT_OVERWRITE' } });
    val(await docs.createDocument({ path: c.path, contentHtml: '<p>y</p>', overwrite: true }));
    expect(tiptapToPlainText(await readDoc(c.fileId))).toBe('y');
    expect(await docs.createDocument({ path: 'C:\\My Documents\\a.txt' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_TYPE' } });
  });

  it('sanitizes AI HTML on create', async () => {
    const c = val(await docs.createDocument({ path: 'C:\\My Documents\\s.wpd', contentHtml: '<p>hi<script>alert(1)</script></p>' }));
    expect(JSON.stringify(await readDoc(c.fileId))).not.toMatch(/script|alert/);
  });

  it('updates by replace, append, section, and selection', async () => {
    const c = val(await docs.createDocument({ path: 'C:\\My Documents\\u.wpd', contentHtml: '<h1>One</h1><p>aaa</p><h1>Two</h1><p>bbb</p>' }));
    val(await docs.updateDocument({ fileId: c.fileId, mode: 'append', contentHtml: '<p>ccc</p>' }));
    expect(tiptapToPlainText(await readDoc(c.fileId))).toBe('One\naaa\nTwo\nbbb\nccc');
    val(await docs.updateDocument({ fileId: c.fileId, mode: 'replaceSection', section: 'one', contentHtml: '<p>new</p>' }));
    expect(tiptapToPlainText(await readDoc(c.fileId))).toBe('One\nnew\nTwo\nbbb\nccc');
    // "One"(h1)=pos 0..5, "new" paragraph starts at 5; text begins at 6.
    val(await docs.updateDocument({ fileId: c.fileId, mode: 'replaceSelection', range: { from: 7, to: 9 }, contentHtml: '<p>X</p>' }));
    expect(tiptapToPlainText(await readDoc(c.fileId))).toBe('One\nnX\nTwo\nbbb\nccc');
    expect(await docs.updateDocument({ fileId: c.fileId, mode: 'replaceSelection', range: { from: 0, to: 9999 }, contentHtml: 'x' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await docs.updateDocument({ fileId: c.fileId, mode: 'replaceSection', section: 'Nope', contentHtml: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    val(await docs.updateDocument({ fileId: c.fileId, mode: 'replace', contentHtml: '<p>all</p>' }));
    expect(tiptapToPlainText(await readDoc(c.fileId))).toBe('all');
  });

  it('inserts an image after a heading, at the end, and at a position, storing only the vfsId', async () => {
    const d = val(await docs.createDocument({ path: 'C:\\My Documents\\r.wpd', contentHtml: '<h2>Applications</h2><p>a</p><h2>Data Centers</h2><p>dc</p>' }));
    const img = val(await docs.createDrawing({ path: 'C:\\My Pictures\\data-center.png', imageBase64: b64(PNG_BYTES) }));
    val(await docs.insertImageIntoDocument({ documentId: d.fileId, imageId: img.fileId, position: { afterHeading: 'Data Centers' }, alt: 'Data center' }));
    const doc = await readDoc(d.fileId);
    expect(doc.content?.map((x) => x.type)).toEqual(['heading', 'paragraph', 'heading', 'image', 'paragraph']);
    expect(doc.content?.[3]?.attrs).toEqual({ vfsId: img.fileId, alt: 'Data center', width: null });
    expect(JSON.stringify(doc)).not.toContain('src');
    val(await docs.insertImageIntoDocument({ documentId: d.fileId, imageId: img.fileId, position: 'end' }));
    expect((await readDoc(d.fileId)).content?.at(-1)?.type).toBe('image');
    val(await docs.insertImageIntoDocument({ documentId: d.fileId, imageId: img.fileId, position: { pos: 0 } }));
    expect((await readDoc(d.fileId)).content?.[0]?.type).toBe('image');
    expect(await docs.insertImageIntoDocument({ documentId: d.fileId, imageId: img.fileId, position: { afterHeading: 'Zzz' } })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await docs.insertImageIntoDocument({ documentId: d.fileId, imageId: d.fileId, position: 'end' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_TYPE' } });
    expect(events.at(-1)?.source).toBe('insertImage');
  });
});

describe('drawing actions', () => {
  it('creates a blank PNG and a PNG from base64, with overwrite policy', async () => {
    const blank = val(await docs.createDrawing({ path: 'C:\\My Pictures\\blank', width: 8, height: 4 }));
    expect(blank.path).toBe('C:\\My Pictures\\blank.png');
    const bytes = new Uint8Array(val(await svc.read(blank.fileId)).bytes);
    expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(await docs.createDrawing({ path: blank.path })).toMatchObject({ ok: false, error: { code: 'CONFLICT_OVERWRITE' } });
    expect(await docs.createDrawing({ path: 'C:\\My Pictures\\x.png', imageBase64: 'bm90IGEgcG5n' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_TYPE' } });
    expect(await docs.createDrawing({ path: 'C:\\My Pictures\\y.png', width: 0, height: 5 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('updates a drawing in place', async () => {
    const d = val(await docs.createDrawing({ path: 'C:\\My Pictures\\d.png', imageBase64: 'data:image/png;base64,' + b64(PNG_BYTES) }));
    const next = new Uint8Array([...PNG_BYTES, 9, 9]);
    expect(val(await docs.updateDrawing({ fileId: d.fileId, imageBase64: b64(next) })).fileId).toBe(d.fileId);
    expect(new Uint8Array(val(await svc.read(d.fileId)).bytes)).toEqual(next);
    expect(await docs.updateDrawing({ fileId: 'nope', imageBase64: b64(next) })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await docs.updateDrawing({ fileId: d.fileId, imageBase64: '###' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});
