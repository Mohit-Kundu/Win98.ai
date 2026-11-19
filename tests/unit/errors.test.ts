import { describe, expect, it } from 'vitest';
import { err, ok } from '../../shared/errors';

describe('Result helpers', () => {
  it('builds ok and error results', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    const e = err('NOT_FOUND', 'missing');
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.error.code).toBe('NOT_FOUND');
  });
});
