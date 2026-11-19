// Verifies the docs set exists and that PROGRESS.md uses only valid status labels.
// Run with: node scripts/check-docs.ts (Node 22.18+ strips TypeScript types natively).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_DOCS = [
  'ARCHITECTURE_DECISIONS.md',
  'DEPENDENCIES.md',
  'PROGRESS.md',
  'TECH_DEBT.md',
  'INTERFACES.md',
  'TOOLS.md',
  'TEST_RESULTS.md',
];
const VALID_LABELS = ['Not started', 'In progress', 'Implemented', 'Tested', 'Blocked'];

const errors: string[] = [];

for (const name of REQUIRED_DOCS) {
  if (!existsSync(join(root, 'docs', name))) errors.push(`Missing docs/${name}`);
}

const progressPath = join(root, 'docs', 'PROGRESS.md');
if (existsSync(progressPath)) {
  // Checklist rows look like: | 1.1 | Title | Implemented |
  const rowRe = /^\|\s*(\d+(?:\.\d+)?)\s*\|(.*)\|\s*([^|]*?)\s*\|\s*$/;
  let rows = 0;
  readFileSync(progressPath, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const m = rowRe.exec(line);
      if (!m) return;
      rows++;
      if (!VALID_LABELS.includes(m[3] ?? '')) {
        errors.push(`docs/PROGRESS.md:${i + 1}: invalid status "${m[3]}" for item ${m[1]}`);
      }
    });
  if (rows === 0) errors.push('docs/PROGRESS.md has no checklist rows');
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('check-docs: OK');
