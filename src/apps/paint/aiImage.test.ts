import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../shared/errors';
import { fitWithin, runAutomate } from './aiImage';

describe('fitWithin', () => {
  it('keeps small images', () => expect(fitWithin(100, 50)).toEqual({ width: 100, height: 50, scale: 1 }));
  it('downscales the long side to 4096', () => {
    const r = fitWithin(8192, 4096);
    expect(r).toMatchObject({ width: 4096, height: 2048, scale: 0.5 });
  });
  it('never returns zero', () => expect(fitWithin(100000, 1).height).toBe(1));
});

describe('runAutomate', () => {
  it('places the image on success', async () => {
    const place = vi.fn(async () => ok({}));
    const r = await runAutomate('cat', { generate: async () => ok({ dataBase64: 'AAA' }), place });
    expect(r.ok).toBe(true);
    expect(place).toHaveBeenCalledWith('AAA');
  });

  it('rejects an empty prompt without calling the AI', async () => {
    const generate = vi.fn();
    const r = await runAutomate('  ', { generate, place: vi.fn() });
    expect(r.ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it('leaves the canvas alone when generation fails', async () => {
    const place = vi.fn();
    const r = await runAutomate('cat', { generate: async () => err('AI_FAILED', 'Nope.'), place });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('not changed');
    expect(place).not.toHaveBeenCalled();
  });

  it('reports a decode failure from place', async () => {
    const r = await runAutomate('cat', { generate: async () => ok({ dataBase64: 'x' }), place: async () => err('UNSUPPORTED_TYPE', 'bad') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNSUPPORTED_TYPE');
  });

  it('times out and aborts the request', async () => {
    const place = vi.fn();
    const r = await runAutomate(
      'cat',
      {
        timeoutMs: 20,
        place,
        generate: (_p, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(err('AI_FAILED', 'aborted')))),
      },
    );
    expect(!r.ok && r.error.code).toBe('AI_TIMEOUT');
    expect(place).not.toHaveBeenCalled();
  });

  it('cancels from the caller signal', async () => {
    const outer = new AbortController();
    const p = runAutomate('cat', { place: vi.fn(), generate: (_p, s) => new Promise((res) => s.addEventListener('abort', () => res(err('AI_FAILED', 'x')))) }, outer.signal);
    outer.abort();
    const r = await p;
    expect(!r.ok && r.error.code).toBe('DECLINED');
  });
});
