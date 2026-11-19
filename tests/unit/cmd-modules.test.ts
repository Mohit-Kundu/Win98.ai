import { describe, expect, it } from 'vitest';
import {
  formatPrompt,
  historyReducer,
  historyText,
  initialHistory,
  initialMode,
  joinArgs,
  modeReducer,
  parseLine,
  tokenize,
} from '../../src/apps/cmd';

describe('tokenize', () => {
  it('splits on whitespace and keeps quoted paths together', () => {
    expect(tokenize('cd "C:\\My Documents\\a b"')).toEqual(['cd', 'C:\\My Documents\\a b']);
    expect(tokenize('  dir   C:\\  ')).toEqual(['dir', 'C:\\']);
    expect(tokenize('mkdir ""')).toEqual(['mkdir', '']);
  });

  it('round-trips awkward arguments', () => {
    const args = ['a b', 'C:\\dir\\', 'x"y', '\\\\"', '', 'plain'];
    expect(tokenize(joinArgs(args))).toEqual(args);
  });

  it('tolerates an unterminated quote', () => {
    expect(tokenize('cd "My Documents')).toEqual(['cd', 'My Documents']);
  });
});

describe('parseLine', () => {
  it('parses built-ins case-insensitively', () => {
    expect(parseLine('DIR "My Documents"')).toEqual({ kind: 'builtin', name: 'dir', args: ['My Documents'] });
  });

  it('names unknown commands', () => {
    expect(parseLine('foo bar')).toEqual({ kind: 'unknown', name: 'foo' });
  });

  it('parses ai and nl commands', () => {
    expect(parseLine('ai make a folder "X Y"')).toEqual({ kind: 'ai', instruction: 'make a folder "X Y"' });
    expect(parseLine('ai').kind).toBe('invalid');
    expect(parseLine('nl on')).toEqual({ kind: 'nlMode', on: true });
    expect(parseLine('nl off')).toEqual({ kind: 'nlMode', on: false });
    expect(parseLine('nl maybe').kind).toBe('invalid');
  });

  it('routes non-built-ins to the AI only in nl mode', () => {
    expect(parseLine('create a folder', true)).toEqual({ kind: 'ai', instruction: 'create a folder' });
    expect(parseLine('dir', true).kind).toBe('builtin');
    expect(parseLine('create a folder', false).kind).toBe('unknown');
    expect(parseLine('   ').kind).toBe('empty');
  });
});

describe('formatPrompt', () => {
  it('appends > to the cwd', () => {
    expect(formatPrompt('C:\\')).toBe('C:\\>');
    expect(formatPrompt('C:\\My Documents')).toBe('C:\\My Documents>');
  });
});

describe('historyReducer', () => {
  it('walks back and forward through entries', () => {
    let s = initialHistory;
    s = historyReducer(s, { type: 'push', line: 'dir' });
    s = historyReducer(s, { type: 'push', line: 'cd x' });
    s = historyReducer(s, { type: 'up' });
    expect(historyText(s)).toBe('cd x');
    s = historyReducer(s, { type: 'up' });
    s = historyReducer(s, { type: 'up' });
    expect(historyText(s)).toBe('dir');
    s = historyReducer(s, { type: 'down' });
    s = historyReducer(s, { type: 'down' });
    s = historyReducer(s, { type: 'down' });
    expect(historyText(s)).toBe('');
  });

  it('ignores blank lines and consecutive duplicates', () => {
    let s = historyReducer(initialHistory, { type: 'push', line: 'dir' });
    s = historyReducer(s, { type: 'push', line: 'dir' });
    s = historyReducer(s, { type: 'push', line: '  ' });
    expect(s.entries).toEqual(['dir']);
  });
});

describe('modeReducer', () => {
  it('toggles natural-language mode', () => {
    const on = modeReducer(initialMode, { type: 'nl on' });
    expect(on.nl).toBe(true);
    expect(modeReducer(on, { type: 'nl off' }).nl).toBe(false);
  });
});
