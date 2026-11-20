// Runs the full Vitest suite then the full Playwright suite (sequentially). When both are green it
// appends rows to docs/TEST_RESULTS.md and promotes the PROGRESS.md labels of items listed in COVERED to "Tested".
// Nothing is changed when either run fails. Run with: node scripts/record-results.ts
// (Node 22.18+ strips TypeScript types natively.)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const progressPath = join(root, 'docs', 'PROGRESS.md');
const resultsPath = join(root, 'docs', 'TEST_RESULTS.md');

// Items covered by Vitest and/or Playwright specs. Items not listed here (including optional property tests,
// checkpoints and documentation tasks) are never promoted by this script.
const COVERED = [
  '1.2', '1.5', '3.1', '3.2', '3.8', '3.11', '3.13', '5.1', '5.3', '5.6', '5.8', '5.10', '5.13',
  '7.1', '7.2', '7.3', '7.6', '7.7', '7.9', '7.10', '7.12', '9.1', '9.2', '9.4', '9.6', '9.8', '9.10',
  '11.1', '11.2', '13.1', '13.2', '13.3', '13.4', '13.5', '13.6', '13.7', '13.8', '13.9', '13.10',
];
const PROMOTABLE_FROM = ['Not started', 'In progress', 'Implemented'];

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

function run(command: string): { ok: boolean; out: string } {
  console.log(`> ${command}`);
  const r = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = stripAnsi(`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return { ok: r.status === 0, out };
}

const vitest = run('npm test');
if (!vitest.ok) {
  console.error(vitest.out.split(/\r?\n/).slice(-40).join('\n'));
  console.error('record-results: Vitest run failed. Docs not updated.');
  process.exit(1);
}
const e2e = run('npm run e2e');
if (!e2e.ok) {
  console.error(e2e.out.split(/\r?\n/).slice(-40).join('\n'));
  console.error('record-results: Playwright run failed. Docs not updated.');
  process.exit(1);
}

const files = /Test Files\s+(\d+) passed \((\d+)\)/.exec(vitest.out);
const tests = /Tests\s+(\d+) passed \((\d+)\)/.exec(vitest.out);
const pw = /(\d+) passed \(([\d.]+m?s?)\)/.exec(e2e.out);
if (!files || !tests || !pw) {
  console.error('record-results: could not parse run summaries. Docs not updated.');
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const rows = [
  `| ${date} | Vitest | \`npm test\` | Pass | ${files[1]} files, ${tests[1]} tests, 0 failures (docs and scope checks included) |`,
  `| ${date} | Playwright | \`npm run e2e\` | Pass | ${pw[1]} tests, 0 failures, 1 worker, Mock_Gemini |`,
];

const resultsLines = readFileSync(resultsPath, 'utf8').split(/\r?\n/);
const filtered = resultsLines.filter((l) => !l.includes('(none recorded yet)'));
let lastRow = -1;
filtered.forEach((l, i) => {
  if (l.startsWith('|')) lastRow = i;
});
filtered.splice(lastRow + 1, 0, ...rows);
writeFileSync(resultsPath, filtered.join('\n'));

let promoted = 0;
const progress = readFileSync(progressPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => {
    const m = /^\|\s*(\d+(?:\.\d+)?)\s*\|(.*)\|\s*([^|]*?)\s*\|\s*$/.exec(line);
    if (!m || !COVERED.includes(m[1] ?? '') || !PROMOTABLE_FROM.includes(m[3] ?? '')) return line;
    promoted++;
    return `| ${m[1]} |${m[2]}| Tested |`;
  });
writeFileSync(progressPath, progress.join('\n'));
console.log(`record-results: recorded ${rows.length} rows, promoted ${promoted} items to Tested.`);
