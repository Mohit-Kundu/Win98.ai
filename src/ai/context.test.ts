import { afterEach, describe, expect, it } from 'vitest';
import { buildAiContext, registerContextProvider, type AppContextSnapshot } from './context';

const cleanups: Array<() => void> = [];
function reg(appId: string, windowId: string, snap: AppContextSnapshot) {
  cleanups.push(registerContextProvider({ appId, windowId, describe: () => snap }));
}
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe('buildAiContext', () => {
  it('returns only the focused window snapshot', () => {
    reg('cmd', 'w1', { app: 'cmd', cwd: 'C:\\A' });
    reg('paint', 'w2', { app: 'paint', dirty: false, width: 1, height: 1 });
    const ctx = buildAiContext('w1');
    expect(ctx.activeApp).toBe('cmd');
    expect(ctx.cwdHint).toBe('C:\\A');
    expect(JSON.stringify(ctx)).not.toContain('paint');
  });

  it('truncates selection to 4000 and excerpt to 2000 chars', () => {
    reg('wordpad', 'w1', {
      app: 'wordpad',
      selection: { from: 0, to: 9000, text: 'x'.repeat(9000) },
      docTextExcerpt: 'y'.repeat(5000),
    });
    const snap = buildAiContext('w1').snapshot as Extract<AppContextSnapshot, { app: 'wordpad' }>;
    expect(snap.selection!.text).toHaveLength(4000);
    expect(snap.docTextExcerpt).toHaveLength(2000);
  });

  it('returns empty context without focus or provider', () => {
    expect(buildAiContext(null)).toEqual({});
    expect(buildAiContext('nope')).toEqual({});
  });
});
