// Fails when production code contains hardcoded AI responses, placeholder markers, or excluded features.
// Run with: node scripts/check-scope.ts (Node 22.18+ strips TypeScript types natively).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

interface Rule {
  rule: string;
  re: RegExp;
}

const SOURCE_DIRS = ['src', 'server', 'shared'];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|css|html)$/;
const TEST_FILE = /\.(test|spec)\.[tj]sx?$/;
/** Mock_Gemini and its fixtures are test-only and never loaded in production (Requirement 15.2). */
const MOCK_FILES = new Set(['server/mockGemini.ts']);
/** The only production file allowed to load Mock_Gemini (dynamic import guarded by MOCK_GEMINI=1). */
const MOCK_LOADER = 'server/index.ts';

// Requirement 16.5: no placeholder UI. The HTML `placeholder=` attribute on inputs is real UI and allowed.
const PLACEHOLDER_RULES: Rule[] = [
  { rule: 'placeholder marker', re: /placeholder(?!\s*[=:])/i },
  { rule: 'unfinished marker', re: /\b(TODO|FIXME|XXX|coming soon|not implemented|lorem ipsum)\b/i },
];

// Requirement 16.5: no hardcoded AI responses or simulated tool execution.
const HARDCODED_AI_RULES: Rule[] = [
  { rule: 'hardcoded/simulated AI', re: /\b(canned|hard-?coded|simulated?|fake)\s*(ai|gemini|response|reply|tool)/i },
  { rule: 'simulated tool execution', re: /\bsimulate(d|s)?\b.*\b(tool|call|execution)\b/i },
  { rule: 'hardcoded AI', re: /\b(fakeGemini|fakeResponse|cannedReply|cannedResponse)\b/ },
];

// Requirements 16.1 to 16.4: excluded capabilities (code-level markers).
const EXCLUDED_RULES: Rule[] = [
  { rule: 'voice (16.1)', re: /\b(speechSynthesis|SpeechSynthesisUtterance|SpeechRecognition|webkitSpeechRecognition|getUserMedia)\b/ },
  { rule: 'auth/accounts (16.1)', re: /\b(passport|jsonwebtoken|next-auth|firebase\/auth|oauth)\b/i },
  { rule: 'cloud sync/multiplayer (16.1)', re: /\b(socket\.io|WebSocket|WebRTC|RTCPeerConnection|firebase|supabase)\b/ },
  { rule: 'OS virtualization (16.1)', re: /\b(v86|jor1k|qemu|WebAssembly\.instantiate)\b/i },
  { rule: 'background execution (16.2)', re: /\b(serviceWorker|SharedWorker|new Worker\(|requestIdleCallback|periodicSync|registration\.sync)\b/ },
  { rule: 'vector database (16.2)', re: /\b(chromadb|pinecone|qdrant|weaviate|pgvector|faiss|embedContent|embeddings?)\b/i },
  { rule: 'multi-agent/long-term memory (16.2)', re: /\b(langchain|langgraph|autogen|crewai|mem0)\b/i },
  { rule: 'CMD subprocess (16.3)', re: /\b(child_process|spawn\(|execSync|execFile)\b/ },
  { rule: 'PDF export/layout (16.4)', re: /\b(jspdf|html2pdf|pdf-lib|pdfmake|pdfkit|window\.print)\b/i },
];

const EXCLUDED_DEPENDENCIES = [
  /^socket\.io/,
  /^ws$/,
  /^passport/,
  /^jsonwebtoken$/,
  /^firebase/,
  /^@supabase\//,
  /^(chromadb|@pinecone-database\/pinecone|@qdrant\/js-client-rest|weaviate-ts-client|faiss-node)$/,
  /^(langchain|@langchain\/|autogen|crewai)/,
  /^(jspdf|html2pdf\.js|pdf-lib|pdfmake|pdfkit)$/,
  /^(v86|xterm-pty|node-pty)$/,
];

/** Requirement 16.3: the CMD ships exactly these built-in commands. del, rd and restore belong to the Recycle Bin. */
const ALLOWED_CMD_BUILTINS = ['dir', 'cd', 'mkdir', 'del', 'rd', 'restore', 'cls', 'help'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function scanLines(file: string, rules: Rule[], source: string, out: Violation[]): void {
  source.split(/\r?\n/).forEach((text, i) => {
    for (const { rule, re } of rules) {
      if (re.test(text)) out.push({ file, line: i + 1, rule, text: text.trim().slice(0, 140) });
    }
  });
}

export function scanScope(root: string): Violation[] {
  const out: Violation[] = [];

  for (const dir of SOURCE_DIRS) {
    for (const abs of walk(join(root, dir))) {
      const file = relative(root, abs).split(sep).join('/');
      if (!SOURCE_EXT.test(file) || TEST_FILE.test(file) || MOCK_FILES.has(file)) continue;
      const source = readFileSync(abs, 'utf8');
      scanLines(file, PLACEHOLDER_RULES, source, out);
      scanLines(file, HARDCODED_AI_RULES, source, out);
      scanLines(file, EXCLUDED_RULES, source, out);
      // Mock_Gemini must not be referenced from the browser bundle or any server file except the guarded loader.
      if (file !== MOCK_LOADER) {
        scanLines(file, [{ rule: 'mock Gemini in production code', re: /mockGemini|MOCK_GEMINI|tests\/fixtures/ }], source, out);
      }
    }
  }

  // Requirement 16.3: the built-in command list is closed.
  const parsePath = join(root, 'src/apps/cmd/parseCommand.ts');
  if (existsSync(parsePath)) {
    const m = /BUILTIN_COMMANDS\s*=\s*\[([^\]]*)\]/.exec(readFileSync(parsePath, 'utf8'));
    const names = m ? [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] as string) : [];
    const extra = names.filter((n) => !ALLOWED_CMD_BUILTINS.includes(n));
    if (!m || extra.length > 0) {
      out.push({
        file: 'src/apps/cmd/parseCommand.ts',
        line: 1,
        rule: 'CMD scope (16.3)',
        text: m ? `unexpected built-in commands: ${extra.join(', ')}` : 'BUILTIN_COMMANDS not found',
      });
    }
  }

  // Excluded dependencies.
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string> };
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (EXCLUDED_DEPENDENCIES.some((re) => re.test(dep))) {
        out.push({ file: 'package.json', line: 1, rule: 'excluded dependency (16.1-16.4)', text: dep });
      }
    }
  }

  // Requirement 10.12: the API key must never be reachable from browser code.
  for (const abs of walk(join(root, 'src'))) {
    const file = relative(root, abs).split(sep).join('/');
    if (!SOURCE_EXT.test(file) || TEST_FILE.test(file)) continue;
    scanLines(file, [{ rule: 'API key referenced in src (10.12)', re: /GEMINI_API_KEY|VITE_[A-Z_]*(KEY|SECRET|TOKEN)/ }], readFileSync(abs, 'utf8'), out);
  }

  return out;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = scanScope(root);
  if (violations.length > 0) {
    console.error(violations.map((v) => `${v.file}:${v.line}: [${v.rule}] ${v.text}`).join('\n'));
    process.exit(1);
  }
  console.log('check-scope: OK');
}
