// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

const SENTINEL_KEY = 'AIzaSy-test-sentinel-key-0123456789';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('production build secrecy (Requirement 10.12)', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'win98-dist-'));
  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it('contains neither the key value nor the string GEMINI_API_KEY', async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = SENTINEL_KEY;
    try {
      await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
    const files = walk(outDir).filter((f) => /\.(js|css|html|json|map)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toContain(SENTINEL_KEY);
      expect(text, f).not.toContain('GEMINI_API_KEY');
    }
  }, 180_000);
});
