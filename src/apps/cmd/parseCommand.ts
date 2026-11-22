import { tokenize } from './tokenize';

export const BUILTIN_COMMANDS = ['dir', 'cd', 'mkdir', 'del', 'rd', 'restore', 'cls', 'help'] as const;
export type BuiltinName = (typeof BUILTIN_COMMANDS)[number];

export type ParsedCommand =
  | { kind: 'empty' }
  | { kind: 'builtin'; name: BuiltinName; args: string[] }
  | { kind: 'ai'; instruction: string }
  | { kind: 'nlMode'; on: boolean }
  | { kind: 'unknown'; name: string }
  | { kind: 'invalid'; name: string; message: string };

export interface ParseOptions {
  /** When true, input that is not a built-in (or `nl`) is a natural-language instruction. */
  nlMode?: boolean;
  /** Original line, used to keep the instruction text exactly as typed. */
  rawLine?: string;
}

function isBuiltin(name: string): name is BuiltinName {
  return (BUILTIN_COMMANDS as readonly string[]).includes(name);
}

export function parseCommand(tokens: readonly string[], opts: ParseOptions = {}): ParsedCommand {
  const first = tokens[0];
  if (first === undefined) return { kind: 'empty' };
  const name = first.toLowerCase();
  const args = tokens.slice(1);

  if (name === 'nl') {
    const arg = args[0]?.toLowerCase();
    if (args.length === 1 && (arg === 'on' || arg === 'off')) return { kind: 'nlMode', on: arg === 'on' };
    return { kind: 'invalid', name: 'nl', message: 'Usage: nl on | nl off' };
  }
  if (isBuiltin(name)) return { kind: 'builtin', name, args };

  if (name === 'ai') {
    const raw = opts.rawLine?.trimStart();
    const instruction = (raw !== undefined ? raw.slice(first.length) : args.join(' ')).trim();
    if (instruction === '') return { kind: 'invalid', name: 'ai', message: 'Usage: ai <instruction>' };
    return { kind: 'ai', instruction };
  }

  if (opts.nlMode) {
    const instruction = (opts.rawLine ?? tokens.join(' ')).trim();
    return { kind: 'ai', instruction };
  }
  return { kind: 'unknown', name: first };
}

/** Convenience: tokenize and parse a raw input line. */
export function parseLine(line: string, nlMode = false): ParsedCommand {
  return parseCommand(tokenize(line), { nlMode, rawLine: line });
}
