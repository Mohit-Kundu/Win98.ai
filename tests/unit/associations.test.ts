import { describe, expect, it } from 'vitest';
import { appForFileName, MAX_UPLOAD_BYTES, validateUpload } from '../../src/actions/associations';

describe('appForFileName', () => {
  it('maps extensions case-insensitively', () => {
    const cases: Array<[string, string]> = [
      ['a.PNG', 'paint'], ['a.jpg', 'paint'], ['a.JPEG', 'paint'],
      ['a.wpd', 'wordpad'], ['a.TXT', 'wordpad'], ['a.md', 'wordpad'],
      ['a.Pdf', 'pdfPreview'],
    ];
    for (const [name, app] of cases) {
      expect(appForFileName(name)).toEqual({ ok: true, value: app });
    }
  });

  it('returns UNSUPPORTED_TYPE naming the extension', () => {
    const r = appForFileName('virus.exe');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNSUPPORTED_TYPE');
      expect(r.error.message).toContain('exe');
    }
  });

  it('rejects names without extension and prototype keys', () => {
    expect(appForFileName('README').ok).toBe(false);
    expect(appForFileName('x.constructor').ok).toBe(false);
  });
});

describe('validateUpload', () => {
  it('accepts allowed types up to the limit', () => {
    expect(validateUpload('a.pdf', MAX_UPLOAD_BYTES)).toEqual({ ok: true, value: { ext: 'pdf' } });
    expect(validateUpload('a.JPG', 0).ok).toBe(true);
  });

  it('rejects oversize files mentioning the limit', () => {
    const r = validateUpload('a.png', MAX_UPLOAD_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('TOO_LARGE');
      expect(r.error.message).toContain('20 MB');
    }
  });

  it('rejects unsupported types naming the type', () => {
    const r = validateUpload('a.docx', 10);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNSUPPORTED_TYPE');
      expect(r.error.message).toContain('docx');
    }
  });
});
