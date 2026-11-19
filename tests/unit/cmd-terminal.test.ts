import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VfsDb } from '../../src/vfs/db';
import { VfsEmitter } from '../../src/vfs/events';
import { createVfsService, type VfsService } from '../../src/vfs/service';
import { createCoreActions } from '../../src/actions/core';
import { createExecuteCommand, type ExecuteCommand } from '../../src/actions/command';
import { LineEditor } from '../../src/apps/cmd/lineEditor';
import { getCmdSnapshot, setCmdState, clearCmdState } from '../../src/apps/cmd/context';

let svc: VfsService;
let exec: ExecuteCommand;
let n = 0;

beforeEach(async () => {
  svc = createVfsService(new VfsDb(`test-cmd-${n++}`), new VfsEmitter());
  await svc.init();
  exec = createExecuteCommand(createCoreActions({ vfs: svc, launch: vi.fn(() => null) }));
});

const run = async (line: string, cwd = 'C:\\') => {
  const r = await exec({ line, cwd });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe('executeCommand', () => {
  it('lists the first-run folders with dir', async () => {
    const r = await run('dir');
    const text = r.output.join('\n');
    expect(text).toContain('Directory of C:\\');
    expect(text).toContain('My Documents');
    expect(text).toContain('<DIR>');
  });

  it('mkdir with a quoted path containing spaces, then cd into it', async () => {
    await run('mkdir "C:\\My Documents\\New Stuff"');
    const cd = await run('cd "My Documents\\New Stuff"');
    expect(cd.cwd).toBe('C:\\My Documents\\New Stuff');
    const up = await run('cd ..', cd.cwd);
    expect(up.cwd).toBe('C:\\My Documents');
    expect((await run('dir', up.cwd)).output.join('\n')).toContain('New Stuff');
  });

  it('dir reflects renames made outside CMD', async () => {
    await run('mkdir Projects');
    const node = await svc.resolve('C:\\Projects');
    if (!node.ok) throw new Error('missing');
    await svc.rename(node.value.id, 'Work');
    const text = (await run('dir')).output.join('\n');
    expect(text).toContain('Work');
    expect(text).not.toContain('Projects');
  });

  it('names the unknown command and the missing path', async () => {
    expect((await run('frobnicate')).output.join('')).toContain('frobnicate');
    const r = await run('cd Nope');
    expect(r.output.join('')).toContain('Nope');
    expect(r.cwd).toBe('C:\\');
    expect((await run('dir ..\\..\\x')).output.join('')).toContain('..\\..\\x');
  });

  it('supports cls, help, nl mode, and prints a clear message for ai', async () => {
    expect((await run('cls')).clear).toBe(true);
    expect((await run('help')).output.join('\n')).toContain('MKDIR');
    expect((await run('nl on')).nlMode).toBe(true);
    const ai = await run('ai make a folder');
    expect(ai.aiInstruction).toBe('make a folder');
    expect(ai.output.join('')).toMatch(/AI assistant/);
  });

  it('returns a structured error for invalid input and never throws', async () => {
    const r = await exec({ line: 5 as unknown as string, cwd: 'C:\\' });
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('LineEditor', () => {
  it('buffers input, handles backspace, and submits on Enter', () => {
    const e = new LineEditor('C:\\>');
    expect(e.feed('dix').output).toBe('dix');
    expect(e.feed('\x7f').output).toBe('\b \b');
    const r = e.feed('r\r');
    expect(r.submitted).toEqual(['dir']);
    expect(e.buffer).toBe('');
  });

  it('recalls history with up and down arrows', () => {
    const e = new LineEditor('C:\\>');
    e.feed('one\rtwo\r');
    expect(e.feed('\x1b[A').output).toContain('two');
    expect(e.buffer).toBe('two');
    e.feed('\x1b[A');
    expect(e.buffer).toBe('one');
    e.feed('\x1b[B');
    expect(e.buffer).toBe('two');
    e.feed('\x1b[B');
    expect(e.buffer).toBe('');
  });

  it('ignores backspace on an empty buffer and cancels with Ctrl+C', () => {
    const e = new LineEditor('>');
    expect(e.feed('\x7f').output).toBe('');
    e.feed('abc');
    e.feed('\x03');
    expect(e.buffer).toBe('');
  });
});

describe('CMD context hook', () => {
  it('exposes cwd and last output per window', () => {
    setCmdState('w1', 'C:\\x', ['hi']);
    expect(getCmdSnapshot('w1')).toEqual({ app: 'cmd', cwd: 'C:\\x', lastOutput: ['hi'] });
    clearCmdState('w1');
    expect(getCmdSnapshot('w1')).toBeUndefined();
  });
});
