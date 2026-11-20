import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanScope } from '../../scripts/check-scope';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('check-scope', () => {
  it('finds no violations in the repository (Requirements 16.1-16.5, 10.12)', () => {
    expect(scanScope(repoRoot)).toEqual([]);
  });

  describe('detection on a synthetic tree', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'scope-'));
      mkdirSync(join(dir, 'src'), { recursive: true });
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const scan = (name: string, body: string) => {
      writeFileSync(join(dir, 'src', name), body);
      return scanScope(dir).map((v) => v.rule);
    };

    it('flags placeholder markers but allows the input placeholder attribute', () => {
      expect(scan('a.tsx', '<input placeholder="Search" />')).toEqual([]);
      expect(scan('a.tsx', '// placeholder window')).toContain('placeholder marker');
    });

    it('flags hardcoded AI responses', () => {
      expect(scan('a.ts', 'const cannedResponse = "Sure!";')).toContain('hardcoded AI');
    });

    it('flags excluded features', () => {
      expect(scan('a.ts', 'speechSynthesis.speak(u);')).toContain('voice (16.1)');
      expect(scan('a.ts', 'import { spawn } from "child_process";')).toContain('CMD subprocess (16.3)');
    });

    it('flags the API key in browser code', () => {
      expect(scan('a.ts', 'const k = import.meta.env.VITE_GEMINI_API_KEY;')).toContain('API key referenced in src (10.12)');
    });

    it('ignores test files', () => {
      expect(scan('a.test.ts', '// TODO placeholder')).toEqual([]);
    });
  });
});
