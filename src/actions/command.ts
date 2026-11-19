import type { Result } from '../../shared/errors';
import { parseLine } from '../apps/cmd/parseCommand';
import { actions } from './index';
import type { CoreActions, NodeRecord } from './types';

export interface ExecuteCommandInput {
  line: string;
  cwd: string;
  /** True while `nl on` is active; non-built-in input becomes a natural-language instruction. */
  nlMode?: boolean;
}

export interface ExecuteCommandOutput {
  output: string[];
  cwd: string;
  clear?: boolean;
  /** Set when the line switched natural-language mode. */
  nlMode?: boolean;
  /** Set when the line is an AI instruction that must be routed to the Orchestrator. */
  aiInstruction?: string;
}

export type ExecuteCommand = (i: ExecuteCommandInput) => Promise<Result<ExecuteCommandOutput>>;

const HELP_LINES = [
  'Supported commands:',
  '  DIR [path]     List the contents of a folder.',
  '  CD [path]      Show or change the current folder. CD .. goes up one level.',
  '  MKDIR path     Create a folder.',
  '  CLS            Clear the screen.',
  '  HELP           Show this list.',
  '  NL ON | NL OFF Turn natural-language mode on or off.',
  '  AI <text>      Ask the AI assistant to do something.',
  'Quote paths that contain spaces, for example: cd "My Documents"',
];

const NL_NEEDS_AI = 'Natural-language mode needs the AI assistant, which is not connected to this window yet.';

function two(n: number): string {
  return String(n).padStart(2, '0');
}

function formatStamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}  ${two(h % 12 === 0 ? 12 : h % 12)}:${two(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

function describeFailure(code: string, message: string, path: string): string {
  if (code === 'NOT_FOUND' || code === 'PATH_OUTSIDE_ROOT' || code === 'INVALID_PATH') {
    return `The system cannot find the path specified: ${path}`;
  }
  if (code === 'ALREADY_EXISTS') return `A subdirectory or file ${path} already exists.`;
  return message;
}

/** Build executeCommand on top of the core actions. Reads the VFS fresh on every call. */
export function createExecuteCommand(core: Pick<CoreActions, 'listFolder' | 'createFolder'>): ExecuteCommand {
  const done = (cwd: string, output: string[], extra: Partial<ExecuteCommandOutput> = {}): Result<ExecuteCommandOutput> => ({
    ok: true,
    value: { output, cwd, ...extra },
  });

  return async ({ line, cwd, nlMode }) => {
    try {
      if (typeof line !== 'string' || typeof cwd !== 'string') {
        return { ok: false, error: { code: 'VALIDATION', message: 'A command line and a working directory are required.' } };
      }
      const cmd = parseLine(line, nlMode === true);
      switch (cmd.kind) {
        case 'empty':
          return done(cwd, []);
        case 'unknown':
          return done(cwd, [`'${cmd.name}' is not recognized as an internal or external command.`]);
        case 'invalid':
          return done(cwd, [cmd.message]);
        case 'nlMode':
          return done(cwd, [cmd.on ? 'Natural-language mode is on. Type "nl off" to return to standard commands.' : 'Natural-language mode is off.'], {
            nlMode: cmd.on,
          });
        case 'ai':
          return done(cwd, [NL_NEEDS_AI], { aiInstruction: cmd.instruction });
        case 'builtin':
          break;
      }

      const path = cmd.args.join(' ');
      switch (cmd.name) {
        case 'help':
          return done(cwd, HELP_LINES);
        case 'cls':
          return done(cwd, [], { clear: true });
        case 'cd': {
          if (path === '') return done(cwd, [cwd]);
          const r = await core.listFolder({ path, cwd });
          if (!r.ok) return done(cwd, [describeFailure(r.error.code, r.error.message, path)]);
          return done(r.value.folder.path, []);
        }
        case 'mkdir': {
          if (path === '') return done(cwd, ['The syntax of the command is incorrect. Usage: mkdir <path>']);
          const r = await core.createFolder({ path, cwd });
          if (!r.ok) return done(cwd, [describeFailure(r.error.code, r.error.message, path)]);
          return done(cwd, []);
        }
        case 'dir': {
          const r = await core.listFolder({ path: path === '' ? cwd : path, cwd });
          if (!r.ok) {
            const shown = path === '' ? cwd : path;
            return done(cwd, [r.error.code === 'INVALID_PATH' && /not a folder/.test(r.error.message) ? `File not found: ${shown}` : describeFailure(r.error.code, r.error.message, shown)]);
          }
          const items: NodeRecord[] = [...r.value.items].sort((a, b) =>
            a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
          );
          const out = [` Directory of ${r.value.folder.path}`, ''];
          for (const n of items) {
            const size = n.kind === 'folder' ? '<DIR>'.padStart(14) : String(n.size).padStart(14);
            out.push(`${formatStamp(n.modifiedAt)} ${size} ${n.name}`);
          }
          const files = items.filter((n) => n.kind === 'file');
          const bytes = files.reduce((s, n) => s + n.size, 0);
          out.push(`${String(files.length).padStart(15)} File(s) ${String(bytes).padStart(14)} bytes`);
          out.push(`${String(items.length - files.length).padStart(15)} Dir(s)`);
          return done(cwd, out);
        }
      }
    } catch (e) {
      return { ok: false, error: { code: 'WRITE_FAILED', message: 'The command failed unexpectedly.', details: e instanceof Error ? e.message : String(e) } };
    }
  };
}

/** executeCommand bound to the shared application actions. */
export const executeCommand: ExecuteCommand = (i) => createExecuteCommand(actions)(i);
